-- Append-only audit trail for explicitly staged Hotspot layout deployments.
create table if not exists isp_hotspot_layout_deployments (
  id bigserial primary key,
  admin_id bigint not null references isp_admins(id) on delete cascade,
  router_id bigint not null references isp_routers(id) on delete cascade,
  layout_id text not null,
  layout_version text not null,
  status text not null check (status in ('staging', 'success', 'failed')),
  profile_name text not null,
  previous_directory text not null,
  deployed_directory text not null,
  files jsonb not null default '[]'::jsonb,
  rollback_verified boolean,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists isp_hotspot_layout_deployments_tenant_router_time
  on isp_hotspot_layout_deployments (admin_id, router_id, created_at desc);

alter table isp_hotspot_layout_deployments enable row level security;
revoke all on table isp_hotspot_layout_deployments from anon, authenticated;
grant select, insert, update on table isp_hotspot_layout_deployments to service_role;

-- Tenant-owned, independent copies of generated portal packages.
create table if not exists isp_hotspot_layout_library (
  id text primary key,
  admin_id bigint not null references isp_admins(id) on delete cascade,
  source_layout_id text not null,
  name text not null,
  description text not null default '',
  version text not null default '1.0.0',
  status text not null default 'active' check (status in ('active', 'archived')),
  package_html text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists isp_hotspot_layout_library_tenant_status
  on isp_hotspot_layout_library (admin_id, status, created_at desc);

alter table isp_hotspot_layout_library enable row level security;
revoke all on table isp_hotspot_layout_library from anon, authenticated;
grant select, insert, update on table isp_hotspot_layout_library to service_role;
