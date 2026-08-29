alter table if exists isp_admins
  add column if not exists payment_collection_mode text not null default 'shared';

alter table if exists isp_admins
  add column if not exists payment_service_config jsonb not null default '{}'::jsonb;

update isp_admins
set payment_collection_mode = 'shared'
where payment_collection_mode is null
   or payment_collection_mode not in ('shared', 'separate');

alter table if exists isp_admins
  drop constraint if exists isp_admins_payment_collection_mode_check;

alter table if exists isp_admins
  add constraint isp_admins_payment_collection_mode_check
  check (payment_collection_mode in ('shared', 'separate'));

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
  if tx.customer_id is not null and tx.plan_id is not null then
    update isp_customers as c
       set plan_id = tx.plan_id,
           status = 'active',
           expires_at = now() + make_interval(days => greatest(coalesce((
             select p.validity_days from isp_plans as p
              where p.id = tx.plan_id and p.admin_id = tx.admin_id
           ), 1), 1)),
           updated_at = now()
     where c.id = tx.customer_id
       and c.admin_id = tx.admin_id
       and c.type = 'pppoe'
       and exists (
         select 1 from isp_plans as active_plan
          where active_plan.id = tx.plan_id
            and active_plan.admin_id = tx.admin_id
            and active_plan.is_active = true
            and lower(coalesce(active_plan.type, '')) = 'pppoe'
       );
    customer_id_to_credit := tx.customer_id;
  end if;
  if tx.payment_method in ('mpesa_registration', 'manual_registration') and tx.admin_id is not null then
    update isp_admins set is_active = true, status = 'active', updated_at = now() where id = tx.admin_id;
    return query select true, tx.payment_method, tx.admin_id, tx.amount, null::bigint;
    return;
  end if;
  if tx.customer_id is null and tx.payment_phone is not null and tx.payment_phone <> '' then
    normalized_phone := regexp_replace(tx.payment_phone, '\D', '', 'g');
    select c.id into customer_id_to_credit from isp_customers as c
    where regexp_replace(c.phone, '\D', '', 'g') = normalized_phone
      and (tx.admin_id is null or c.admin_id = tx.admin_id)
    order by c.id limit 1 for update;
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