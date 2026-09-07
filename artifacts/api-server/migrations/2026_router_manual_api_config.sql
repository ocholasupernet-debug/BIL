-- Persist the complete manual RouterOS connection configuration.
alter table if exists isp_routers
  add column if not exists api_port integer not null default 8728;

alter table if exists isp_routers
  add column if not exists api_use_ssl boolean not null default false;

alter table if exists isp_routers
  add column if not exists main_bridge_interface text;

alter table if exists isp_routers
  add column if not exists description text;