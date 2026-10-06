-- A paid M-Pesa checkout is the idempotency key for Hotspot account creation.
-- Locking its transaction row serializes concurrent captive-portal retries.
create or replace function public.claim_prepaid_hotspot_transaction_account(
  p_transaction_id bigint,
  p_admin_id bigint,
  p_plan_id bigint,
  p_router_id bigint,
  p_port_id bigint,
  p_customer_fields jsonb
)
returns table (
  customer_id bigint,
  created_new boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  tx public.isp_transactions%rowtype;
  selected_plan public.isp_plans%rowtype;
  expected_customer_admin_id bigint;
  existing_customer_id bigint;
  new_customer_id bigint;
  requested_username text;
  transaction_mac text;
  requested_mac text;
begin
  if p_customer_fields is null or jsonb_typeof(p_customer_fields) is distinct from 'object' then
    raise exception 'Hotspot account details are required.';
  end if;

  select * into tx
    from public.isp_transactions
   where id = p_transaction_id
     and admin_id = p_admin_id
     and plan_id = p_plan_id
     and payment_method = 'mpesa'
     and status in ('completed', 'paid', 'success')
   for update;
  if not found then
    raise exception 'The confirmed Hotspot payment could not be claimed.';
  end if;

  select * into selected_plan
    from public.isp_plans
   where id = p_plan_id
     and admin_id = p_admin_id
   for share;
  if not found
     or lower(coalesce(selected_plan.type, '')) <> 'hotspot'
     or selected_plan.router_id is distinct from p_router_id
     or selected_plan.port_id is distinct from p_port_id then
    raise exception 'The paid checkout does not match the requested Hotspot service.';
  end if;

  expected_customer_admin_id := coalesce(selected_plan.owner_reseller_id, p_admin_id);
  if nullif(p_customer_fields ->> 'admin_id', '')::bigint is distinct from expected_customer_admin_id
     or nullif(p_customer_fields ->> 'plan_id', '')::bigint is distinct from p_plan_id
     or nullif(p_customer_fields ->> 'router_id', '')::bigint is distinct from p_router_id
     or nullif(p_customer_fields ->> 'port_id', '')::bigint is distinct from p_port_id
     or p_customer_fields ->> 'type' is distinct from 'hotspot'
     or nullif(btrim(p_customer_fields ->> 'name'), '') is null
     or nullif(btrim(p_customer_fields ->> 'phone'), '') is null
     or nullif(btrim(p_customer_fields ->> 'password'), '') is null
     or nullif(p_customer_fields ->> 'expires_at', '') is null
     or p_customer_fields ->> 'status' is distinct from 'active' then
    raise exception 'The requested Hotspot account details do not match the paid service.';
  end if;

  transaction_mac := regexp_replace(upper(coalesce(tx.mac_address, '')), '[^0-9A-F]', '', 'g');
  requested_mac := regexp_replace(upper(coalesce(p_customer_fields ->> 'mac_address', '')), '[^0-9A-F]', '', 'g');
  if length(transaction_mac) <> 12 or transaction_mac is distinct from requested_mac then
    raise exception 'The Hotspot account device does not match the paid checkout.';
  end if;

  requested_username := nullif(btrim(p_customer_fields ->> 'username'), '');
  if requested_username is null then
    raise exception 'A Hotspot username is required.';
  end if;

  if tx.customer_id is not null then
    select customer.id into existing_customer_id
      from public.isp_customers as customer
     where customer.id = tx.customer_id
       and customer.admin_id = expected_customer_admin_id
       and customer.type = 'hotspot'
       and customer.router_id = p_router_id
       and customer.port_id is not distinct from p_port_id
     for update;
    if not found then
      raise exception 'The payment is already linked to a different Hotspot account or service.';
    end if;
    return query select existing_customer_id, false;
    return;
  end if;

  insert into public.isp_customers (
    admin_id,
    name,
    phone,
    username,
    password,
    plan_id,
    router_id,
    port_id,
    type,
    ip_address,
    mac_address,
    status,
    expires_at,
    depletion_reason,
    created_at,
    updated_at
  ) values (
    expected_customer_admin_id,
    btrim(p_customer_fields ->> 'name'),
    btrim(p_customer_fields ->> 'phone'),
    requested_username,
    p_customer_fields ->> 'password',
    p_plan_id,
    p_router_id,
    p_port_id,
    'hotspot',
    nullif(p_customer_fields ->> 'ip_address', ''),
    p_customer_fields ->> 'mac_address',
    'active',
    (p_customer_fields ->> 'expires_at')::timestamptz,
    nullif(p_customer_fields ->> 'depletion_reason', ''),
    coalesce(nullif(p_customer_fields ->> 'created_at', '')::timestamptz, now()),
    coalesce(nullif(p_customer_fields ->> 'updated_at', '')::timestamptz, now())
  )
  returning id into new_customer_id;

  update public.isp_transactions
     set customer_id = new_customer_id
   where id = tx.id
     and customer_id is null;
  if not found then
    raise exception 'The paid Hotspot account could not be linked to its transaction.';
  end if;

  return query select new_customer_id, true;
end;
$$;

revoke all on function public.claim_prepaid_hotspot_transaction_account(bigint, bigint, bigint, bigint, bigint, jsonb) from public;
grant execute on function public.claim_prepaid_hotspot_transaction_account(bigint, bigint, bigint, bigint, bigint, jsonb) to service_role;

notify pgrst, 'reload schema';
