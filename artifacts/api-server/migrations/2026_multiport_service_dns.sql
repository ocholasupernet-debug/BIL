-- Store independent DNS names for each isolated port service profile.
alter table if exists public.isp_reseller_ports
  add column if not exists hotspot_dns_name text,
  add column if not exists pppoe_dns_name text;

alter table if exists public.isp_reseller_ports
  drop constraint if exists isp_reseller_ports_hotspot_dns_name_check,
  drop constraint if exists isp_reseller_ports_pppoe_dns_name_check;

alter table if exists public.isp_reseller_ports
  add constraint isp_reseller_ports_hotspot_dns_name_check
    check (hotspot_dns_name is null or hotspot_dns_name ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'),
  add constraint isp_reseller_ports_pppoe_dns_name_check
    check (pppoe_dns_name is null or pppoe_dns_name ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$');

notify pgrst, 'reload schema';