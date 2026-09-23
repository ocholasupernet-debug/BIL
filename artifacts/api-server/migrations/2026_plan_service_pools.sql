-- Keep the RouterOS pool used by each service plan explicit.
-- The values are names, not ranges: VLAN service provisioning remains the
-- owner of pool ranges and plans only reference those existing pools.
alter table if exists public.isp_plans
  add column if not exists active_ip_pool text,
  add column if not exists expired_ip_pool text;

create index if not exists isp_plans_active_ip_pool_idx
  on public.isp_plans(admin_id, router_id, port_id, active_ip_pool);

notify pgrst, 'reload schema';