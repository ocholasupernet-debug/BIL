-- Keep platform registration receipts out of tenant revenue and renewal
-- assessments while preserving all existing append-only ledger rows.

create or replace function public.record_transaction_revenue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account_id_to_record bigint;
begin
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
  if new.payment_method in ('mpesa_registration', 'manual_registration') then
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

-- Historical registration rows remain in the append-only ledger for audit,
-- but are excluded from tenant-facing revenue summaries.
create or replace function public.get_revenue_summary(p_account_id bigint)
returns table (
  income_today numeric,
  income_month numeric,
  total_revenue numeric,
  total_transactions bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with local_clock as (
    select timezone('Africa/Nairobi', now()) as local_now
  ),
  bounds as (
    select
      date_trunc('day', local_now) at time zone 'Africa/Nairobi' as day_start,
      (date_trunc('day', local_now) + interval '1 day') at time zone 'Africa/Nairobi' as day_end,
      date_trunc('month', local_now) at time zone 'Africa/Nairobi' as month_start,
      (date_trunc('month', local_now) + interval '1 month') at time zone 'Africa/Nairobi' as month_end
    from local_clock
  )
  select
    coalesce(sum(case
      when ledger.occurred_at >= bounds.day_start and ledger.occurred_at < bounds.day_end
      then ledger.amount else 0 end), 0),
    coalesce(sum(case
      when ledger.occurred_at >= bounds.month_start and ledger.occurred_at < bounds.month_end
      then ledger.amount else 0 end), 0),
    coalesce(sum(ledger.amount), 0),
    count(*)::bigint
  from public.revenue_ledger as ledger
  cross join bounds
  where ledger.revenue_account_id = p_account_id
    and coalesce(ledger.payment_method, '') not in ('mpesa_registration', 'manual_registration');
$$;

create or replace function public.get_platform_income_summary()
returns table (
  registration_today numeric,
  registration_month numeric,
  registration_total numeric,
  registration_transactions bigint,
  renewal_today numeric,
  renewal_month numeric,
  renewal_total numeric,
  renewal_transactions bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with local_clock as (
    select timezone('Africa/Nairobi', now()) as local_now
  ),
  bounds as (
    select
      date_trunc('day', local_now) at time zone 'Africa/Nairobi' as day_start,
      (date_trunc('day', local_now) + interval '1 day') at time zone 'Africa/Nairobi' as day_end,
      date_trunc('month', local_now) at time zone 'Africa/Nairobi' as month_start,
      (date_trunc('month', local_now) + interval '1 month') at time zone 'Africa/Nairobi' as month_end
    from local_clock
  ),
  platform_income as (
    select
      'registration'::text as income_type,
      tx.amount,
      tx.created_at as occurred_at
    from public.isp_transactions as tx
    where tx.payment_method in ('mpesa_registration', 'manual_registration')
      and tx.status in ('completed', 'paid', 'success')
    union all
    select
      'renewal'::text as income_type,
      invoice.amount_due as amount,
      invoice.paid_at as occurred_at
    from public.platform_billing_invoices as invoice
    where invoice.status = 'paid'
      and invoice.paid_at is not null
  )
  select
    coalesce(sum(platform_income.amount) filter (
      where platform_income.income_type = 'registration'
        and platform_income.occurred_at >= bounds.day_start
        and platform_income.occurred_at < bounds.day_end
    ), 0),
    coalesce(sum(platform_income.amount) filter (
      where platform_income.income_type = 'registration'
        and platform_income.occurred_at >= bounds.month_start
        and platform_income.occurred_at < bounds.month_end
    ), 0),
    coalesce(sum(platform_income.amount) filter (
      where platform_income.income_type = 'registration'
    ), 0),
    count(*) filter (where platform_income.income_type = 'registration')::bigint,
    coalesce(sum(platform_income.amount) filter (
      where platform_income.income_type = 'renewal'
        and platform_income.occurred_at >= bounds.day_start
        and platform_income.occurred_at < bounds.day_end
    ), 0),
    coalesce(sum(platform_income.amount) filter (
      where platform_income.income_type = 'renewal'
        and platform_income.occurred_at >= bounds.month_start
        and platform_income.occurred_at < bounds.month_end
    ), 0),
    coalesce(sum(platform_income.amount) filter (
      where platform_income.income_type = 'renewal'
    ), 0),
    count(*) filter (where platform_income.income_type = 'renewal')::bigint
  from platform_income
  cross join bounds;
$$;

revoke all on function public.get_platform_income_summary() from public, anon, authenticated;
grant execute on function public.get_platform_income_summary() to service_role;