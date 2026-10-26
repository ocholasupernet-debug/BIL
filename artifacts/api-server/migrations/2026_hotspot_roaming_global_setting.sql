create table if not exists public.isp_hotspot_roaming_settings (
  admin_id bigint primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint isp_hotspot_roaming_settings_positive_admin check (admin_id > 0)
);

alter table public.isp_hotspot_roaming_settings enable row level security;
revoke all on table public.isp_hotspot_roaming_settings from public, anon, authenticated;
grant select, insert, update on table public.isp_hotspot_roaming_settings to service_role;
