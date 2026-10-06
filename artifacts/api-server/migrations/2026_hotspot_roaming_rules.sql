-- Explicit tenant-owned permissions for using a purchased hotspot service
-- on other MikroTik ports. A NULL source or target port means router-wide.
create table if not exists public.isp_hotspot_roaming_rules (
  id bigserial primary key,
  admin_id bigint not null,
  source_router_id bigint not null,
  source_port_id bigint,
  target_router_id bigint not null,
  target_port_id bigint,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint isp_hotspot_roaming_rules_positive_ids check (
    admin_id > 0
    and source_router_id > 0
    and (source_port_id is null or source_port_id > 0)
    and target_router_id > 0
    and (target_port_id is null or target_port_id > 0)
  )
);

create unique index if not exists isp_hotspot_roaming_rules_scope_unique
  on public.isp_hotspot_roaming_rules (
    admin_id,
    source_router_id,
    coalesce(source_port_id, 0),
    target_router_id,
    coalesce(target_port_id, 0)
  );

create index if not exists isp_hotspot_roaming_rules_enabled_source_idx
  on public.isp_hotspot_roaming_rules (admin_id, source_router_id, source_port_id)
  where enabled;

create index if not exists isp_hotspot_roaming_rules_enabled_target_idx
  on public.isp_hotspot_roaming_rules (admin_id, target_router_id, target_port_id)
  where enabled;
