-- Persistent management address for MikroTik OpenVPN clients.
-- bridge_ip remains the router's customer-LAN/captive-portal gateway.
alter table if exists isp_routers add column if not exists vpn_ip text;
create unique index if not exists isp_routers_vpn_ip_unique_idx
  on isp_routers(vpn_ip) where vpn_ip is not null;