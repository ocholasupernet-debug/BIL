alter table if exists public.isp_reseller_ports
  add column if not exists vlan_ingress_mode text not null default 'tagged';

update public.isp_reseller_ports
set vlan_ingress_mode = 'tagged'
where vlan_ingress_mode is null
   or vlan_ingress_mode not in ('tagged', 'untagged');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'isp_reseller_ports_vlan_ingress_mode_check'
      and conrelid = 'public.isp_reseller_ports'::regclass
  ) then
    alter table public.isp_reseller_ports
      add constraint isp_reseller_ports_vlan_ingress_mode_check
      check (vlan_ingress_mode in ('tagged', 'untagged'));
  end if;
end $$;

notify pgrst, 'reload schema';