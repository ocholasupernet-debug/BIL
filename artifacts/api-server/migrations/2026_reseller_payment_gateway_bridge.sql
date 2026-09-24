-- Reseller payment destinations use the platform Daraja credentials.
-- Never store consumer keys, consumer secrets, passkeys, or callback secrets
-- in reseller-owned rows.

alter table if exists public.payment_gateways
  drop constraint if exists payment_gateways_gateway_type_check;

alter table if exists public.payment_gateways
  add constraint payment_gateways_gateway_type_check
  check (gateway_type in ('stripe', 'paypal', 'mpesa', 'bank'));

alter table if exists public.payment_gateways
  add column if not exists merchant_identifier text,
  add column if not exists account_reference text,
  add column if not exists config_json jsonb not null default '{}'::jsonb;

create index if not exists payment_gateways_mpesa_active_idx
  on public.payment_gateways(user_id, gateway_type, is_active);

alter table if exists public.isp_transactions
  add column if not exists reseller_id bigint references public.isp_admins(id) on delete set null,
  add column if not exists reseller_port_id bigint references public.isp_reseller_ports(id) on delete set null,
  add column if not exists payment_metadata jsonb not null default '{}'::jsonb;

create index if not exists isp_transactions_reseller_idx
  on public.isp_transactions(reseller_id, created_at desc);

create or replace function public.settle_verified_mpesa_transaction(
  p_transaction_id bigint,
  p_status text,
  p_note text
)
returns table (
  settled boolean,
  payment_method text,
  admin_id bigint,
  amount numeric,
  credited_customer_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  tx isp_transactions%rowtype;
  customer_id_to_credit bigint;
  normalized_phone text;
  matching_customer_id bigint;
begin
  if p_status not in ('completed', 'failed') then
    raise exception 'Unsupported settlement status';
  end if;

  select * into tx
  from isp_transactions
  where id = p_transaction_id and status = 'pending'
  for update;

  if not found then
    return query select false, null::text, null::bigint, null::numeric, null::bigint;
    return;
  end if;

  update isp_transactions
  set status = p_status,
      notes = p_note
  where id = tx.id;

  if p_status = 'failed' then
    if tx.payment_method = 'mpesa_registration' and tx.admin_id is not null then
      update isp_admins
      set status = 'payment_failed', updated_at = now()
      where id = tx.admin_id;
    end if;
    return query select true, tx.payment_method, tx.admin_id, tx.amount, null::bigint;
    return;
  end if;

  /*
   * The row is locked above, so this increment is part of the same
   * idempotent state transition as the payment settlement. A replay sees no
   * pending row and cannot credit the reseller a second time.
   */
  if tx.reseller_id is not null then
    update isp_admins
    set earnings_balance = coalesce(earnings_balance, 0) + tx.amount,
        updated_at = now()
    where id = tx.reseller_id
      and parent_id = tx.admin_id
      and role = 'reseller'
      and is_active = true;

    if not found then
      raise exception 'Reseller payment metadata does not belong to this ISP';
    end if;
  end if;

  if tx.customer_id is not null and tx.plan_id is not null then
    select c.id into matching_customer_id
    from isp_customers as c
    join isp_plans as p
      on p.id = tx.plan_id
     and p.admin_id = tx.admin_id
     and p.is_active = true
     and lower(coalesce(p.type, '')) = 'pppoe'
    join isp_reseller_ports as rp
      on rp.id = p.port_id
     and rp.admin_id = p.admin_id
     and rp.router_id = p.router_id
     and rp.handoff_mode = 'vlan_services'
     and rp.status <> 'disabled'
     and rp.status = 'active'
     and rp.link_status = 'active'
     and (
       (p.owner_reseller_id is null and rp.assigned_reseller_id is null)
       or p.owner_reseller_id = rp.assigned_reseller_id
     )
    where c.id = tx.customer_id
      and c.admin_id = case when p.owner_reseller_id is null then tx.admin_id else p.owner_reseller_id end
      and c.type = 'pppoe'
      -- A shared router is not a tenant boundary. Require the customer to
      -- carry the exact service port selected by the package.
      and c.router_id = p.router_id
      and c.port_id = p.port_id;

    if matching_customer_id is null then
      update isp_transactions
         set status = 'failed',
             notes = 'Verified payment could not be applied: PPPoE customer and active plan do not match.'
       where id = tx.id;
      return query select true, tx.payment_method, tx.admin_id, tx.amount, null::bigint;
      return;
    end if;

    update isp_customers as c
       set plan_id = tx.plan_id,
           status = 'active',
           expires_at = now() + coalesce((
             select case lower(coalesce(p.validity_unit, 'days'))
               when 'mins' then make_interval(mins => greatest(coalesce(p.validity, p.validity_days), 1))
               when 'hours' then make_interval(hours => greatest(coalesce(p.validity, p.validity_days), 1))
               when 'weeks' then make_interval(days => greatest(coalesce(p.validity, p.validity_days), 1) * 7)
               when 'months' then make_interval(days => greatest(coalesce(p.validity, p.validity_days), 1) * 30)
               else make_interval(days => greatest(coalesce(p.validity, p.validity_days), 1))
             end
               from isp_plans as p
              where p.id = tx.plan_id and p.admin_id = tx.admin_id
           ), make_interval(days => 1)),
           updated_at = now()
     where c.id = tx.customer_id
        and c.admin_id = case when (
          select owner_reseller_id from isp_plans where id = tx.plan_id
        ) is null then tx.admin_id else (
          select owner_reseller_id from isp_plans where id = tx.plan_id
        ) end
       and c.type = 'pppoe'
       and exists (
         select 1 from isp_plans as active_plan
          where active_plan.id = tx.plan_id
            and active_plan.admin_id = tx.admin_id
            and active_plan.is_active = true
            and lower(coalesce(active_plan.type, '')) = 'pppoe'
       );
    customer_id_to_credit := matching_customer_id;
  end if;

  if tx.payment_method in ('mpesa_registration', 'manual_registration') and tx.admin_id is not null then
    update isp_admins
    set is_active = true, status = 'active', updated_at = now()
    where id = tx.admin_id;
    return query select true, tx.payment_method, tx.admin_id, tx.amount, null::bigint;
    return;
  end if;

  if tx.customer_id is null and tx.payment_phone is not null and tx.payment_phone <> '' then
    normalized_phone := regexp_replace(tx.payment_phone, '\D', '', 'g');
    select c.id into customer_id_to_credit
    from isp_customers as c
    where regexp_replace(c.phone, '\D', '', 'g') = normalized_phone
      and (tx.admin_id is null or c.admin_id = tx.admin_id)
    order by c.id
    limit 1
    for update;

    if customer_id_to_credit is not null then
      update isp_customers
      set wallet_balance = wallet_balance + tx.amount,
          mac_address = coalesce(tx.mac_address, mac_address),
          updated_at = now()
      where id = customer_id_to_credit;
    end if;
  end if;

  return query select true, tx.payment_method, tx.admin_id, tx.amount, customer_id_to_credit;
end;
$$;

revoke all on function public.settle_verified_mpesa_transaction(bigint, text, text) from public;
grant execute on function public.settle_verified_mpesa_transaction(bigint, text, text) to service_role;

notify pgrst, 'reload schema';