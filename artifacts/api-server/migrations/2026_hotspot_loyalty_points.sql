-- Tenant-scoped Hotspot loyalty balances, rules, and an append-only ledger.
create table if not exists public.isp_loyalty_settings (
  admin_id bigint primary key references public.isp_admins(id) on delete cascade,
  kes_per_point numeric(12,2) not null default 0 check (kes_per_point >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.isp_loyalty_plan_rules (
  id bigserial primary key,
  admin_id bigint not null references public.isp_admins(id) on delete cascade,
  plan_id bigint not null references public.isp_plans(id) on delete cascade,
  points_awarded integer check (points_awarded is null or points_awarded >= 0),
  redemption_points integer check (redemption_points is null or redemption_points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (admin_id, plan_id)
);

create table if not exists public.isp_loyalty_accounts (
  admin_id bigint not null references public.isp_admins(id) on delete cascade,
  phone text not null check (phone ~ '^254[17][0-9]{8}$'),
  points_balance bigint not null default 0 check (points_balance >= 0),
  updated_at timestamptz not null default now(),
  primary key (admin_id, phone)
);

create table if not exists public.isp_loyalty_ledger (
  id bigserial primary key,
  admin_id bigint not null references public.isp_admins(id) on delete cascade,
  phone text not null check (phone ~ '^254[17][0-9]{8}$'),
  transaction_id bigint not null references public.isp_transactions(id) on delete restrict,
  plan_id bigint not null references public.isp_plans(id) on delete restrict,
  entry_type text not null check (entry_type in ('purchase_award', 'plan_redemption')),
  source_reference text not null,
  points_delta integer not null check (points_delta <> 0),
  note text,
  created_at timestamptz not null default now(),
  unique (admin_id, source_reference)
);

create index if not exists isp_loyalty_ledger_account_idx
  on public.isp_loyalty_ledger (admin_id, phone, created_at desc);
create unique index if not exists isp_transactions_loyalty_reference_idx
  on public.isp_transactions (admin_id, reference)
  where payment_method = 'loyalty_points' and reference is not null;

-- Award once, only after a verified M-Pesa transaction is attached to its
-- saved Hotspot account. The transaction row lock serializes concurrent retries.
create or replace function public.award_hotspot_loyalty_points(
  p_transaction_id bigint
)
returns table (
  points_awarded integer,
  points_balance bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tx public.isp_transactions%rowtype;
  v_plan public.isp_plans%rowtype;
  v_phone_digits text;
  v_phone text;
  v_customer_digits text;
  v_customer_phone text;
  v_owner_admin_id bigint;
  v_kes_per_point numeric(12, 2) := 0;
  v_plan_award integer;
  v_award integer := 0;
  v_existing_award integer;
  v_balance bigint := 0;
  v_ledger_id bigint;
begin
  select * into v_tx
    from public.isp_transactions
   where id = p_transaction_id
   for update;
  if not found
     or v_tx.status not in ('completed', 'paid', 'success')
     or lower(coalesce(v_tx.payment_method, '')) not like 'mpesa%'
     or v_tx.plan_id is null
     or v_tx.customer_id is null then
    return query select 0, 0::bigint;
    return;
  end if;

  select * into v_plan
    from public.isp_plans
   where id = v_tx.plan_id and admin_id = v_tx.admin_id;
   if not found or lower(coalesce(v_plan.type, '')) <> 'hotspot' then
    return query select 0, 0::bigint;
    return;
  end if;

  v_owner_admin_id := coalesce(v_plan.owner_reseller_id, v_tx.admin_id);
  v_phone_digits := regexp_replace(coalesce(v_tx.payment_phone, ''), '[^0-9]', '', 'g');
  v_phone := case
    when v_phone_digits ~ '^0[17][0-9]{8}$' then '254' || substr(v_phone_digits, 2)
    when v_phone_digits ~ '^[17][0-9]{8}$' then '254' || v_phone_digits
    when v_phone_digits ~ '^254[17][0-9]{8}$' then v_phone_digits
    else ''
  end;
  if v_phone = '' then
    return query select 0, 0::bigint;
    return;
  end if;

  select regexp_replace(coalesce(customer.phone, ''), '[^0-9]', '', 'g')
    into v_customer_digits
    from public.isp_customers as customer
   where customer.id = v_tx.customer_id
     and customer.admin_id = v_owner_admin_id
     and customer.type = 'hotspot'
     and customer.plan_id = v_tx.plan_id;
  v_customer_phone := case
    when v_customer_digits ~ '^0[17][0-9]{8}$' then '254' || substr(v_customer_digits, 2)
    when v_customer_digits ~ '^[17][0-9]{8}$' then '254' || v_customer_digits
    when v_customer_digits ~ '^254[17][0-9]{8}$' then v_customer_digits
    else ''
  end;
  if v_customer_phone is distinct from v_phone then
    return query select 0, 0::bigint;
    return;
  end if;

  select ledger.points_delta into v_existing_award
    from public.isp_loyalty_ledger as ledger
   where ledger.admin_id = v_tx.admin_id
     and ledger.source_reference = 'purchase:' || v_tx.id::text
     and ledger.entry_type = 'purchase_award';
  if found then
    select account.points_balance into v_balance
      from public.isp_loyalty_accounts as account
     where account.admin_id = v_tx.admin_id and account.phone = v_phone;
    return query select v_existing_award, coalesce(v_balance, 0);
    return;
  end if;

  select settings.kes_per_point into v_kes_per_point
    from public.isp_loyalty_settings as settings
   where settings.admin_id = v_tx.admin_id;
  select rule.points_awarded into v_plan_award
    from public.isp_loyalty_plan_rules as rule
   where rule.admin_id = v_tx.admin_id and rule.plan_id = v_tx.plan_id;
  if found and v_plan_award is not null then
    v_award := v_plan_award;
  elsif coalesce(v_kes_per_point, 0) > 0 then
    v_award := least(
      floor(greatest(v_tx.amount, 0) / v_kes_per_point),
      2147483647
    )::integer;
  end if;
  if v_award <= 0 then
    select account.points_balance into v_balance
      from public.isp_loyalty_accounts as account
     where account.admin_id = v_tx.admin_id and account.phone = v_phone;
    return query select 0, coalesce(v_balance, 0);
    return;
  end if;

  insert into public.isp_loyalty_accounts (admin_id, phone)
  values (v_tx.admin_id, v_phone)
  on conflict (admin_id, phone) do nothing;
  select account.points_balance into v_balance
    from public.isp_loyalty_accounts as account
   where account.admin_id = v_tx.admin_id and account.phone = v_phone
   for update;

  insert into public.isp_loyalty_ledger (
    admin_id, phone, transaction_id, plan_id, entry_type,
    source_reference, points_delta, note
  ) values (
    v_tx.admin_id, v_phone, v_tx.id, v_tx.plan_id, 'purchase_award',
    'purchase:' || v_tx.id::text, v_award,
    'Points awarded for a confirmed Hotspot M-Pesa purchase.'
  )
  on conflict (admin_id, source_reference) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is not null then
    update public.isp_loyalty_accounts
       set points_balance = points_balance + v_award,
           updated_at = now()
     where admin_id = v_tx.admin_id and phone = v_phone
     returning points_balance into v_balance;
  end if;
  return query select v_award, coalesce(v_balance, 0);
end;
$$;

-- Redeem the configured points for one Hotspot plan. A null cost uses the
-- whole-point package price; zero explicitly disables redemption. Creating
-- the zero-cash transaction, debit ledger row, and balance update is atomic.
create or replace function public.redeem_hotspot_loyalty_points(
  p_admin_id bigint,
  p_plan_id bigint,
  p_phone text,
  p_mac_address text,
  p_idempotency_key text
)
returns table (
  checkout_id text,
  points_balance bigint,
  points_spent integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_plan public.isp_plans%rowtype;
  v_phone_digits text;
  v_phone text;
  v_mac text;
  v_owner_admin_id bigint;
  v_points_required integer;
  v_reference text;
  v_account_balance bigint := 0;
  v_transaction_id bigint;
  v_existing_tx public.isp_transactions%rowtype;
  v_existing_points_spent integer;
  v_ledger_id bigint;
begin
  if p_admin_id is null or p_admin_id <= 0
     or p_plan_id is null or p_plan_id <= 0
     or coalesce(p_idempotency_key, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'A valid Hotspot plan and redemption request are required.';
  end if;
  v_phone_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_phone := case
    when v_phone_digits ~ '^0[17][0-9]{8}$' then '254' || substr(v_phone_digits, 2)
    when v_phone_digits ~ '^[17][0-9]{8}$' then '254' || v_phone_digits
    when v_phone_digits ~ '^254[17][0-9]{8}$' then v_phone_digits
    else ''
  end;
  v_mac := regexp_replace(upper(coalesce(p_mac_address, '')), '[^0-9A-F]', '', 'g');
  if v_phone = '' or length(v_mac) <> 12 or v_mac !~ '^[0-9A-F]{12}$' then
    raise exception 'A valid Kenyan phone number and device are required.';
  end if;

  v_reference := 'LOYALTY-' || lower(p_idempotency_key);
  select * into v_plan
    from public.isp_plans
   where id = p_plan_id and admin_id = p_admin_id;
  if not found
      or lower(coalesce(v_plan.type, '')) <> 'hotspot'
     or v_plan.is_active is not true
     or v_plan.client_can_purchase is not true
     or v_plan.router_id is null then
    raise exception 'This Hotspot plan cannot currently be purchased with points.';
  end if;
  v_owner_admin_id := coalesce(v_plan.owner_reseller_id, p_admin_id);

  select rule.redemption_points into v_points_required
    from public.isp_loyalty_plan_rules as rule
   where rule.admin_id = p_admin_id and rule.plan_id = p_plan_id;
  if v_points_required is null then
    if coalesce(v_plan.price, 0) <= 0 or v_plan.price > 2147483647 then
      raise exception 'This Hotspot plan has no valid points redemption price.';
    end if;
    v_points_required := ceil(v_plan.price)::integer;
  end if;
  if coalesce(v_points_required, 0) <= 0 then
    raise exception 'This plan is not enabled for loyalty redemption.';
  end if;

  if not exists (
    select 1
      from public.isp_customers as customer
      where customer.admin_id in (v_owner_admin_id, p_admin_id)
       and customer.type = 'hotspot'
       and (
         case
           when regexp_replace(coalesce(customer.phone, ''), '[^0-9]', '', 'g') ~ '^0[17][0-9]{8}$'
             then '254' || substr(regexp_replace(coalesce(customer.phone, ''), '[^0-9]', '', 'g'), 2)
           when regexp_replace(coalesce(customer.phone, ''), '[^0-9]', '', 'g') ~ '^[17][0-9]{8}$'
             then '254' || regexp_replace(coalesce(customer.phone, ''), '[^0-9]', '', 'g')
           else regexp_replace(coalesce(customer.phone, ''), '[^0-9]', '', 'g')
         end
       ) = v_phone
  ) then
    raise exception 'This phone number does not have a Hotspot customer account in this service.';
  end if;

  -- An identical retry returns the original checkout without another debit.
  select * into v_existing_tx
    from public.isp_transactions as tx
   where tx.admin_id = p_admin_id
     and tx.reference = v_reference
     and tx.payment_method = 'loyalty_points';
  if found then
    if v_existing_tx.plan_id is distinct from p_plan_id
       or v_existing_tx.payment_phone is distinct from v_phone
       or regexp_replace(upper(coalesce(v_existing_tx.mac_address, '')), '[^0-9A-F]', '', 'g') is distinct from v_mac then
      raise exception 'This redemption request ID has already been used for a different purchase.';
    end if;
    select account.points_balance into v_account_balance
      from public.isp_loyalty_accounts as account
     where account.admin_id = p_admin_id and account.phone = v_phone;
     select abs(ledger.points_delta)::integer into v_existing_points_spent
       from public.isp_loyalty_ledger as ledger
      where ledger.admin_id = p_admin_id
        and ledger.phone = v_phone
        and ledger.transaction_id = v_existing_tx.id
        and ledger.entry_type = 'plan_redemption';
     return query select v_reference, coalesce(v_account_balance, 0), coalesce(v_existing_points_spent, v_points_required);
    return;
  end if;

  insert into public.isp_loyalty_accounts (admin_id, phone)
  values (p_admin_id, v_phone)
  on conflict (admin_id, phone) do nothing;
  select account.points_balance into v_account_balance
    from public.isp_loyalty_accounts as account
   where account.admin_id = p_admin_id and account.phone = v_phone
   for update;
  if v_account_balance < v_points_required then
    -- A concurrent retry with the same key may have completed while this
    -- request waited for the account lock. Return that checkout, not an error.
    select * into v_existing_tx
      from public.isp_transactions as tx
     where tx.admin_id = p_admin_id
       and tx.reference = v_reference
       and tx.payment_method = 'loyalty_points';
    if found then
      if v_existing_tx.plan_id is distinct from p_plan_id
         or v_existing_tx.payment_phone is distinct from v_phone
         or regexp_replace(upper(coalesce(v_existing_tx.mac_address, '')), '[^0-9A-F]', '', 'g') is distinct from v_mac then
        raise exception 'This redemption request ID has already been used for a different purchase.';
      end if;
      select abs(ledger.points_delta)::integer into v_existing_points_spent
        from public.isp_loyalty_ledger as ledger
       where ledger.admin_id = p_admin_id
         and ledger.phone = v_phone
         and ledger.transaction_id = v_existing_tx.id
         and ledger.entry_type = 'plan_redemption';
      return query select v_reference, v_account_balance, coalesce(v_existing_points_spent, v_points_required);
      return;
    end if;
    raise exception 'There are not enough loyalty points for this package.';
  end if;

  insert into public.isp_transactions (
    admin_id, plan_id, amount, payment_method, payment_phone,
    mac_address, reference, status, notes
  ) values (
    p_admin_id, p_plan_id, 0, 'loyalty_points', v_phone,
    upper(regexp_replace(p_mac_address, '[^0-9A-Fa-f]', '', 'g')),
    v_reference, 'completed',
    format('Hotspot package redeemed with %s loyalty points.', v_points_required)
  )
  on conflict do nothing
  returning id into v_transaction_id;

  if v_transaction_id is null then
    select * into v_existing_tx
      from public.isp_transactions as tx
     where tx.admin_id = p_admin_id
       and tx.reference = v_reference
       and tx.payment_method = 'loyalty_points';
    if not found
       or v_existing_tx.plan_id is distinct from p_plan_id
       or v_existing_tx.payment_phone is distinct from v_phone
       or regexp_replace(upper(coalesce(v_existing_tx.mac_address, '')), '[^0-9A-F]', '', 'g') is distinct from v_mac then
      raise exception 'This redemption request ID could not be safely retried.';
    end if;
    select abs(ledger.points_delta)::integer into v_existing_points_spent
      from public.isp_loyalty_ledger as ledger
     where ledger.admin_id = p_admin_id
       and ledger.phone = v_phone
       and ledger.transaction_id = v_existing_tx.id
       and ledger.entry_type = 'plan_redemption';
    return query select v_reference, v_account_balance, coalesce(v_existing_points_spent, v_points_required);
    return;
  end if;

  insert into public.isp_loyalty_ledger (
    admin_id, phone, transaction_id, plan_id, entry_type,
    source_reference, points_delta, note
  ) values (
    p_admin_id, v_phone, v_transaction_id, p_plan_id, 'plan_redemption',
    'redemption:' || lower(p_idempotency_key), -v_points_required,
    'Points redeemed for a Hotspot package.'
  )
  on conflict (admin_id, source_reference) do nothing
  returning id into v_ledger_id;
  if v_ledger_id is null then
    raise exception 'This loyalty debit was already recorded.';
  end if;

  update public.isp_loyalty_accounts
     set points_balance = points_balance - v_points_required,
         updated_at = now()
   where admin_id = p_admin_id
     and phone = v_phone
     and points_balance >= v_points_required
   returning points_balance into v_account_balance;
  if not found then
    raise exception 'There are not enough loyalty points for this package.';
  end if;

  return query select v_reference, v_account_balance, v_points_required;
end;
$$;

revoke all on function public.award_hotspot_loyalty_points(bigint) from public;
grant execute on function public.award_hotspot_loyalty_points(bigint) to service_role;
revoke all on function public.redeem_hotspot_loyalty_points(bigint, bigint, text, text, text) from public;
grant execute on function public.redeem_hotspot_loyalty_points(bigint, bigint, text, text, text) to service_role;

notify pgrst, 'reload schema';
