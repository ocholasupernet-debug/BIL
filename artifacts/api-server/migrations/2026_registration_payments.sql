-- Registration payment settings are stored in the API's durable non-secret
-- settings store. This migration extends the existing atomic settlement RPC so
-- a Super Admin can verify a bank-registration payment without any automatic
-- bank-transfer reconciliation.

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
begin
  if p_status not in ('completed', 'failed') then
    raise exception 'Unsupported settlement status';
  end if;
  select * into tx from isp_transactions
  where id = p_transaction_id and status = 'pending'
  for update;
  if not found then
    return query select false, null::text, null::bigint, null::numeric, null::bigint;
    return;
  end if;
  update isp_transactions set status = p_status, notes = p_note where id = tx.id;
  if p_status = 'failed' then
    if tx.payment_method = 'mpesa_registration' and tx.admin_id is not null then
      update isp_admins set status = 'payment_failed', updated_at = now() where id = tx.admin_id;
    end if;
    return query select true, tx.payment_method, tx.admin_id, tx.amount, null::bigint;
    return;
  end if;
  if tx.payment_method in ('mpesa_registration', 'manual_registration') and tx.admin_id is not null then
    update isp_admins set is_active = true, status = 'active', updated_at = now() where id = tx.admin_id;
    return query select true, tx.payment_method, tx.admin_id, tx.amount, null::bigint;
    return;
  end if;
  if tx.payment_phone is not null and tx.payment_phone <> '' then
    normalized_phone := regexp_replace(tx.payment_phone, '\D', '', 'g');
    select id into customer_id_to_credit from isp_customers
    where regexp_replace(phone, '\D', '', 'g') = normalized_phone
      and (tx.admin_id is null or admin_id = tx.admin_id)
    order by id limit 1 for update;
    if customer_id_to_credit is not null then
      update isp_customers
      set wallet_balance = wallet_balance + tx.amount, updated_at = now()
      where id = customer_id_to_credit;
    end if;
  end if;
  return query select true, tx.payment_method, tx.admin_id, tx.amount, customer_id_to_credit;
end;
$$;

revoke all on function public.settle_verified_mpesa_transaction(bigint, text, text) from public;
grant execute on function public.settle_verified_mpesa_transaction(bigint, text, text) to service_role;

-- Explicit capability marker for the API. This prevents an older settlement
-- RPC (which cannot activate manual registrations) or an incomplete dependent
-- column migration from being treated as ready.
drop function if exists public.registration_payment_schema_version();
create function public.registration_payment_schema_version()
returns table (schema_version integer, payment_phone_available boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    1,
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'isp_admins'
        and column_name = 'payment_phone'
    );
$$;

revoke all on function public.registration_payment_schema_version() from public;
grant execute on function public.registration_payment_schema_version() to service_role;

notify pgrst, 'reload schema';