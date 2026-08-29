-- Tenant-scoped multi-WAN load-balancing settings for MikroTik routers.
-- Safe to replay during deployment.
create table if not exists public.isp_router_load_balancing (
  id                 bigserial primary key,
  admin_id           bigint not null references public.isp_admins(id) on delete cascade,
  router_id          bigint not null references public.isp_routers(id) on delete cascade,
  enabled            boolean not null default false,
  lan_interface      text not null default 'bridge',
  router_os_version  text not null default 'auto'
    check (router_os_version in ('auto', '6', '7')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (admin_id, router_id)
);

create table if not exists public.isp_router_load_balancing_wans (
  id                   bigserial primary key,
  load_balancing_id    bigint not null references public.isp_router_load_balancing(id) on delete cascade,
  admin_id             bigint not null references public.isp_admins(id) on delete cascade,
  name                 text not null,
  interface_name       text not null,
  gateway              inet not null,
  weight               integer not null default 1 check (weight between 1 and 100),
  health_check_ip      inet not null,
  enabled              boolean not null default true,
  position             integer not null default 0 check (position between 0 and 3),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (load_balancing_id, interface_name),
  unique (load_balancing_id, position),
  unique (load_balancing_id, health_check_ip)
);

create index if not exists isp_router_load_balancing_admin_id_idx
  on public.isp_router_load_balancing(admin_id);
create index if not exists isp_router_load_balancing_router_id_idx
  on public.isp_router_load_balancing(router_id);
create index if not exists isp_router_load_balancing_wans_config_id_idx
  on public.isp_router_load_balancing_wans(load_balancing_id);

grant select, insert, update, delete on table public.isp_router_load_balancing to anon, authenticated;
grant select, insert, update, delete on table public.isp_router_load_balancing_wans to anon, authenticated;
grant usage, select on sequence public.isp_router_load_balancing_id_seq to anon, authenticated;
grant usage, select on sequence public.isp_router_load_balancing_wans_id_seq to anon, authenticated;

notify pgrst, 'reload schema';