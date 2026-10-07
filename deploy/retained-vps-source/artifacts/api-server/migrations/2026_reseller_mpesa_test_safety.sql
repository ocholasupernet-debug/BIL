-- Keep reseller gateway test prompts out of customer provisioning, reseller
-- earnings, and the immutable revenue ledger while still recording callback
-- confirmation on the transaction row.

create or replace function public.record_transaction_revenue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account_id_to_record bigint;
begin
  if new.payment_metadata ->> 'source' = 'reseller_gateway_test' then
    return new;
  end if;
  if new.status not in ('completed', 'paid', 'success') then
    return new;
  end if;
  if new.payment_method in ('mpesa_platform_billing', 'platform_billing') then
    update public.platform_billing_invoices
       set status = 'paid',
           payment_transaction_id = new.id,
           paid_at = coalesce(paid_at, now()),
           updated_at = now()
     where id = nullif(new.payment_metadata ->> 'billing_invoice_id', '')::bigint
       and account_id = new.admin_id
       and status in ('due', 'pending');
    return new;
  end if;
  account_id_to_record := coalesce(new.reseller_id, new.admin_id);
  if account_id_to_record is null then
    return new;
  end if;

  insert into public.revenue_ledger (
    revenue_account_id, tenant_id, source_type, source_id, amount,
    payment_method, occurred_at
  )
  values (
    account_id_to_record, new.admin_id, 'isp_transaction', new.id, new.amount,
    new.payment_method, new.created_at
  )
  on conflict (source_type, source_id) do nothing;

  return new;
end;
$$;

create or replace function public.settle_reseller_gateway_test_transaction(
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
  tx public.isp_transactions%rowtype;
begin
  if p_status is null or p_status not in ('completed', 'failed') then
    raise exception 'Unsupported settlement status';
  end if;

  select * into tx
    from public.isp_transactions
   where id = p_transaction_id
     and status = 'pending'
     and payment_method = 'mpesa'
     and payment_metadata ->> 'source' = 'reseller_gateway_test'
     and reseller_id is not null
     and customer_id is null
     and plan_id is null
   for update;

  if not found then
    return query select false, null::text, null::bigint, null::numeric, null::bigint;
    return;
  end if;

  if tx.admin_id is null or not exists (
    select 1
      from public.isp_admins as reseller
     where reseller.id = tx.reseller_id
       and reseller.parent_id = tx.admin_id
       and reseller.role = 'reseller'
  ) then
    raise exception 'Reseller payment test metadata does not belong to this ISP';
  end if;

  update public.isp_transactions
     set status = p_status,
         notes = p_note
   where id = tx.id;

  return query select true, tx.payment_method, tx.admin_id, tx.amount, null::bigint;
end;
$$;

revoke all on function public.settle_reseller_gateway_test_transaction(bigint, text, text) from public;
grant execute on function public.settle_reseller_gateway_test_transaction(bigint, text, text) to service_role;

notify pgrst, 'reload schema';