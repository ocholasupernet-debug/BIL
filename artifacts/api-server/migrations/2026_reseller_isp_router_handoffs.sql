-- A reseller can receive internet through an ISP-managed router/XPON handoff
-- without installing RouterOS packages or changing a reseller-owned device.
alter table if exists public.isp_reseller_ports
  add column if not exists handoff_mode text not null default 'services',
  add column if not exists handoff_type text not null default 'physical',
  add column if not exists xpon_identifier text,
  add column if not exists link_detected boolean not null default false,
  add column if not exists last_link_checked_at timestamptz,
  add column if not exists link_detection_error text;

alter table if exists public.isp_reseller_ports
  drop constraint if exists isp_reseller_ports_router_id_interface_name_key;

create unique index if not exists isp_reseller_ports_physical_interface_uq
  on public.isp_reseller_ports(router_id, interface_name)
  where vlan_tag is null and status <> 'disabled';

create unique index if not exists isp_reseller_ports_vlan_interface_uq
  on public.isp_reseller_ports(router_id, interface_name, vlan_tag)
  where vlan_tag is not null and status <> 'disabled';

alter table if exists public.isp_reseller_ports
  drop constraint if exists isp_reseller_ports_handoff_mode_check;

alter table if exists public.isp_reseller_ports
  add constraint isp_reseller_ports_handoff_mode_check
  check (handoff_mode in ('services', 'isp_router', 'vlan_services'));

alter table if exists public.isp_reseller_ports
  drop constraint if exists isp_reseller_ports_handoff_type_check;

alter table if exists public.isp_reseller_ports
  add constraint isp_reseller_ports_handoff_type_check
  check (handoff_type in ('physical', 'vlan'));

create index if not exists isp_reseller_ports_handoff_idx
  on public.isp_reseller_ports(admin_id, handoff_mode, handoff_type, link_detected);

notify pgrst, 'reload schema';