-- Operational fields used by the prepaid users table.
-- Every statement is idempotent so the deployment runner can safely replay it.
alter table public.isp_plans
  add column if not exists router_id bigint references public.isp_routers(id) on delete set null,
  add column if not exists data_limit_mb numeric(14,2);

alter table public.isp_customers
  add column if not exists router_id bigint references public.isp_routers(id) on delete set null,
  add column if not exists data_used_mb numeric(14,2),
  add column if not exists fup_limit_mb numeric(14,2),
  add column if not exists last_seen timestamptz;

create index if not exists isp_customers_router_id_idx on public.isp_customers(router_id);
create index if not exists isp_customers_last_seen_idx on public.isp_customers(last_seen desc);