-- A reseller VLAN owns two RouterOS address pools: Hotspot and PPPoE.
-- Router-wide legacy pools remain port_id NULL and continue to be supported.
alter table if exists public.isp_ip_pools
  add column if not exists port_id bigint references public.isp_reseller_ports(id) on delete cascade;

create index if not exists isp_ip_pools_port_id_idx
  on public.isp_ip_pools(port_id);

notify pgrst, 'reload schema';