create or replace function public.get_monthly_revenue_summary(p_account_id bigint)
returns table (
  month_start date,
  income numeric,
  payment_count bigint
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
      date_trunc('month', local_now) - interval '11 months' as first_month,
      date_trunc('month', local_now) as current_month
    from local_clock
  ),
  months as (
    select generated.month_start::date as month_start
    from bounds
    cross join lateral generate_series(
      bounds.first_month,
      bounds.current_month,
      interval '1 month'
    ) as generated(month_start)
  ),
  ledger_months as (
    select
      date_trunc('month', ledger.occurred_at at time zone 'Africa/Nairobi')::date as month_start,
      sum(ledger.amount) as income,
      count(*)::bigint as payment_count
    from public.revenue_ledger as ledger
    cross join bounds
    where ledger.revenue_account_id = p_account_id
      and ledger.occurred_at >= (bounds.first_month at time zone 'Africa/Nairobi')
      and ledger.occurred_at < ((bounds.current_month + interval '1 month') at time zone 'Africa/Nairobi')
    group by 1
  )
  select
    months.month_start,
    coalesce(ledger_months.income, 0),
    coalesce(ledger_months.payment_count, 0)
  from months
  left join ledger_months using (month_start)
  order by months.month_start;
$$;

revoke all on function public.get_monthly_revenue_summary(bigint) from public, anon, authenticated;
grant execute on function public.get_monthly_revenue_summary(bigint) to service_role;
