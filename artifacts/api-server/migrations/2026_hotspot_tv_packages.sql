alter table public.isp_plans
  add column if not exists is_tv_package boolean not null default false;

create index if not exists isp_plans_tv_packages_idx
  on public.isp_plans (admin_id, router_id, port_id)
  where is_tv_package is true and is_active is true and client_can_purchase is true;
