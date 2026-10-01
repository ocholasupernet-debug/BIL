-- Map a MikroTik's exact RADIUS NAS-Identifier to each assigned reseller VLAN.
-- A router can serve several VLANs, so the pair is disambiguated at runtime by
-- the canonical per-VLAN HotSpot server name from portServiceResourceNames().

alter table public.isp_reseller_ports
  add column if not exists nas_identifier text collate "C";

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'isp_reseller_ports_nas_identifier_format_check'
      and conrelid = 'public.isp_reseller_ports'::regclass
  ) then
    alter table public.isp_reseller_ports
      add constraint isp_reseller_ports_nas_identifier_format_check
      check (
        nas_identifier is null
        or nas_identifier ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
      );
  end if;
end $$;

-- Repeating one router identity across VLANs is expected. This index only
-- rejects duplicate identity-to-service mappings for the same VLAN resource.
create unique index if not exists isp_reseller_ports_nas_service_unique_idx
  on public.isp_reseller_ports (
    admin_id,
    router_id,
    nas_identifier collate "C",
    assigned_reseller_id,
    vlan_tag
  )
  where handoff_mode = 'vlan_services'
    and nas_identifier is not null
    and assigned_reseller_id is not null
    and vlan_tag is not null;