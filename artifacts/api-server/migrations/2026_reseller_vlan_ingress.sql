-- VLAN reseller services need the physical XPON uplink as well as the
-- service VLAN interface. Without an explicit ingress binding, a tagged
-- service can be configured on a bridge while the XPON port remains outside
-- that bridge and clients fall through to the legacy untagged Hotspot.
alter table if exists public.isp_reseller_ports
  add column if not exists handoff_interface text;

create index if not exists isp_reseller_ports_handoff_interface_idx
  on public.isp_reseller_ports(router_id, handoff_interface)
  where handoff_interface is not null and status <> 'disabled';

notify pgrst, 'reload schema';