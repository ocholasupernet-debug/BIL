create or replace function public.get_previous_month_eligible_sales(
  p_account_id bigint,
  p_billing_period date
)
returns table (
  sales_period_start date,
  sales_period_end date,
  sales_total numeric,
  payment_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select
      (p_billing_period - interval '1 month')::date as local_start,
      p_billing_period as local_end
  )
  select
    bounds.local_start,
    bounds.local_end,
    coalesce(sum(ledger.amount), 0),
    count(ledger.id)::bigint
  from bounds
  left join public.revenue_ledger as ledger
    on ledger.revenue_account_id = p_account_id
    and ledger.occurred_at >= (bounds.local_start::timestamp at time zone 'Africa/Nairobi')
    and ledger.occurred_at < (bounds.local_end::timestamp at time zone 'Africa/Nairobi')
    and coalesce(ledger.payment_method, '') not in (
      'mpesa_registration',
      'manual_registration',
      'mpesa_platform_billing'
    )
  group by bounds.local_start, bounds.local_end;
$$;

revoke all on function public.get_previous_month_eligible_sales(bigint, date) from public, anon, authenticated;
grant execute on function public.get_previous_month_eligible_sales(bigint, date) to service_role;
