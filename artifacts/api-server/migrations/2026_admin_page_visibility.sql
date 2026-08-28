-- Platform-wide visibility controls for ISP Admin Panel modules and pages.
-- Safe to run more than once.
create table if not exists admin_page_visibility (
  feature_key text primary key,
  enabled boolean not null default true,
  updated_by text not null default 'system',
  updated_at timestamptz not null default now()
);

alter table admin_page_visibility enable row level security;
revoke all on table admin_page_visibility from anon, authenticated;
grant select, insert, update on table admin_page_visibility to service_role;

insert into admin_page_visibility (feature_key, enabled)
values
  ('overview', true), ('overview.dashboard', true),
  ('customers', true), ('customers.customers', true), ('customers.activation', true),
  ('customers.vouchers', true), ('customers.hotspot-binding', true),
  ('billing', true), ('billing.plans', true), ('billing.transactions', true),
  ('network', true), ('network.routers', true), ('network.self-install', true),
  ('network.replace-router', true), ('network.migration', true), ('network.pppoe', true),
  ('network.ppp', true), ('network.wireless', true), ('network.queues', true),
  ('network.ip-pools', true), ('network.router-api-config', true), ('network.files', true),
  ('network.bridge-ports', true), ('network.access-points', true),
  ('network.pppoe-settings', true), ('network.hotspot-settings', true),
  ('tools', true), ('tools.vpn', true), ('tools.bulk', true), ('tools.uisp', true),
  ('tools.bonga', true), ('tools.webhooks', true), ('tools.acs', true), ('tools.page-builder', true),
  ('admin', true), ('admin.support', true), ('admin.notifications', true), ('admin.logs', true),
  ('admin.extras', true), ('admin.radius', true), ('admin.settings', true), ('admin.pages', true)
on conflict (feature_key) do nothing;