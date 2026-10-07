-- Store fractional Hotspot rewards without changing the whole-point amount
-- available to existing full-package redemption rules.
alter table public.isp_loyalty_plan_rules
  alter column points_awarded type numeric(14, 2)
  using points_awarded::numeric(14, 2);

alter table public.isp_loyalty_ledger
  alter column points_delta type numeric(14, 2)
  using points_delta::numeric(14, 2);

alter table public.isp_loyalty_accounts
  add column if not exists fractional_balance numeric(3, 2) not null default 0;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.isp_loyalty_accounts'::regclass
       and conname = 'isp_loyalty_accounts_fractional_balance_check'
  ) then
    alter table public.isp_loyalty_accounts
      add constraint isp_loyalty_accounts_fractional_balance_check
      check (fractional_balance >= 0 and fractional_balance < 1);
  end if;
end;
$$;

-- Award exactly once per saved, confirmed M-Pesa transaction. Whole points
-- remain redeemable immediately; the fractional remainder rolls forward.
create or replace function public.award_hotspot_loyalty_points_fractional(
  p_transaction_id bigint
)
returns table (
  points_awarded numeric,
  points_balance numeric
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
  v_plan_award numeric(14, 2);
  v_award numeric(14, 2) := 0;
  v_existing_award numeric(14, 2);
  v_balance bigint := 0;
  v_fractional_balance numeric(3, 2) := 0;
  v_total_fraction numeric(16, 2) := 0;
  v_whole_award bigint := 0;
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
    return query select 0::numeric, 0::numeric;
    return;
  end if;

  select * into v_plan
    from public.isp_plans
   where id = v_tx.plan_id and admin_id = v_tx.admin_id;
  if not found or lower(coalesce(v_plan.type, '')) <> 'hotspot' then
    return query select 0::numeric, 0::numeric;
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
    return query select 0::numeric, 0::numeric;
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
    return query select 0::numeric, 0::numeric;
    return;
  end if;

  select ledger.points_delta into v_existing_award
    from public.isp_loyalty_ledger as ledger
   where ledger.admin_id = v_tx.admin_id
     and ledger.source_reference = 'purchase:' || v_tx.id::text
     and ledger.entry_type = 'purchase_award';
  if found then
    select account.points_balance, account.fractional_balance
      into v_balance, v_fractional_balance
      from public.isp_loyalty_accounts as account
     where account.admin_id = v_tx.admin_id and account.phone = v_phone;
    return query select
      coalesce(v_existing_award, 0)::numeric,
      coalesce(v_balance, 0)::numeric + coalesce(v_fractional_balance, 0)::numeric;
    return;
  end if;

  select settings.kes_per_point into v_kes_per_point
    from public.isp_loyalty_settings as settings
   where settings.admin_id = v_tx.admin_id;
  select rule.points_awarded into v_plan_award
    from public.isp_loyalty_plan_rules as rule
   where rule.admin_id = v_tx.admin_id and rule.plan_id = v_tx.plan_id;
  if found and v_plan_award is not null then
    v_award := least(v_plan_award, 2147483647.00)::numeric(14, 2);
  elsif coalesce(v_kes_per_point, 0) > 0 then
    v_award := least(
      round(greatest(v_tx.amount, 0) / v_kes_per_point, 2),
      2147483647.00
    )::numeric(14, 2);
  end if;
  if v_award <= 0 then
    select account.points_balance, account.fractional_balance
      into v_balance, v_fractional_balance
      from public.isp_loyalty_accounts as account
     where account.admin_id = v_tx.admin_id and account.phone = v_phone;
    return query select
      0::numeric,
      coalesce(v_balance, 0)::numeric + coalesce(v_fractional_balance, 0)::numeric;
    return;
  end if;

  insert into public.isp_loyalty_accounts (admin_id, phone)
  values (v_tx.admin_id, v_phone)
  on conflict (admin_id, phone) do nothing;
  select account.points_balance, account.fractional_balance
    into v_balance, v_fractional_balance
    from public.isp_loyalty_accounts as account
   where account.admin_id = v_tx.admin_id and account.phone = v_phone
   for update;

  insert into public.isp_loyalty_ledger (
    admin_id, phone, transaction_id, plan_id, entry_type,
    source_reference, points_delta, note
  ) values (
    v_tx.admin_id, v_phone, v_tx.id, v_tx.plan_id, 'purchase_award',
    'purchase:' || v_tx.id::text, v_award,
    format('Points awarded for a confirmed Hotspot M-Pesa purchase: %s.', v_award)
  )
  on conflict (admin_id, source_reference) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is not null then
    v_total_fraction := coalesce(v_fractional_balance, 0) + v_award;
    v_whole_award := floor(v_total_fraction)::bigint;
    v_fractional_balance := (v_total_fraction - v_whole_award)::numeric(3, 2);
    update public.isp_loyalty_accounts as account
       set points_balance = account.points_balance + v_whole_award,
           fractional_balance = v_fractional_balance,
           updated_at = now()
     where account.admin_id = v_tx.admin_id and account.phone = v_phone
     returning account.points_balance into v_balance;
  end if;

  return query select
    v_award,
    coalesce(v_balance, 0)::numeric + coalesce(v_fractional_balance, 0)::numeric;
end;
$$;

-- Keep older API processes compatible during a rolling restart. They now use
-- the fractional ledger too; their legacy response still reports whole points.
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
begin
  return query
  select
    floor(award.points_awarded)::integer,
    floor(award.points_balance)::bigint
  from public.award_hotspot_loyalty_points_fractional(p_transaction_id) as award;
end;
$$;

revoke all on function public.award_hotspot_loyalty_points_fractional(bigint) from public;
grant execute on function public.award_hotspot_loyalty_points_fractional(bigint) to service_role;
revoke all on function public.award_hotspot_loyalty_points(bigint) from public;
grant execute on function public.award_hotspot_loyalty_points(bigint) to service_role;

notify pgrst, 'reload schema';
