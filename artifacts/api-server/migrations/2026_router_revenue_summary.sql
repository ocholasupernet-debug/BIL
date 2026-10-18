-- Keep per-router dashboard totals sourced from the immutable revenue ledger.
-- A ledger sale is assigned to the router of its customer or purchased plan.
create or replace function public.get_router_revenue_summary(
  p_account_id bigint,
  p_router_id bigint
)
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
  ),
  router_sales as (
    select ledger.amount, ledger.occurred_at
    from public.revenue_ledger as ledger
    join public.isp_transactions as transaction
      on ledger.source_type = 'isp_transaction'
     and ledger.source_id = transaction.id
    left join public.isp_customers as customer
      on customer.id = transaction.customer_id
    left join public.isp_plans as plan
      on plan.id = coalesce(transaction.plan_id, customer.plan_id)
    where ledger.revenue_account_id = p_account_id
      and coalesce(customer.router_id, plan.router_id) = p_router_id

    union all

    select ledger.amount, ledger.occurred_at
    from public.revenue_ledger as ledger
    join public.isp_reseller_sales as reseller_sale
      on ledger.source_type = 'reseller_sale'
     and ledger.source_id = reseller_sale.id
     and ledger.revenue_account_id = reseller_sale.reseller_id
    join public.isp_reseller_ports as reseller_port
      on reseller_port.id = reseller_sale.reseller_port_id
    where ledger.revenue_account_id = p_account_id
      and reseller_port.router_id = p_router_id
  )
  select
    coalesce(sum(case
      when sale.occurred_at >= bounds.day_start and sale.occurred_at < bounds.day_end
      then sale.amount else 0 end), 0),
    coalesce(sum(case
      when sale.occurred_at >= bounds.month_start and sale.occurred_at < bounds.month_end
      then sale.amount else 0 end), 0),
    coalesce(sum(sale.amount), 0),
    count(*)::bigint
  from router_sales as sale
  cross join bounds;
$$;

revoke all on function public.get_router_revenue_summary(bigint, bigint) from public, anon, authenticated;
grant execute on function public.get_router_revenue_summary(bigint, bigint) to service_role;
