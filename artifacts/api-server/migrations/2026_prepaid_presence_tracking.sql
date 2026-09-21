-- Keep prepaid presence and RouterOS byte counters available to the admin
-- service-status table. The deployment runner applies this idempotently.
alter table public.isp_customers
  add column if not exists data_used_bytes bigint,
  add column if not exists service_online boolean not null default false;

create index if not exists isp_customers_service_online_idx
  on public.isp_customers(service_online);