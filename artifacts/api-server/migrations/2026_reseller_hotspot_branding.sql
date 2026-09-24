-- Tenant-owned captive portal identity.  This is application configuration only;
-- RouterOS deployment remains an explicit, separately authorized action.
create table if not exists isp_hotspot_branding (
  admin_id bigint primary key references isp_admins(id) on delete cascade,
  portal_hostname text,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create unique index if not exists isp_hotspot_branding_hostname_ci
  on isp_hotspot_branding (lower(portal_hostname))
  where portal_hostname is not null;

alter table isp_hotspot_branding enable row level security;
revoke all on table isp_hotspot_branding from anon, authenticated;
grant select, insert, update on table isp_hotspot_branding to service_role;