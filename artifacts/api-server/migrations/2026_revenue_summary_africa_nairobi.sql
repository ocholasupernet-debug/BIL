-- Keep dashboard revenue aligned to the ISP's Kenya calendar, regardless of
-- the PostgreSQL session timezone. Half-open timestamp ranges include the
-- local midnight boundary and exclude the next day/month boundary.
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
  where ledger.revenue_account_id = p_account_id;
$$;