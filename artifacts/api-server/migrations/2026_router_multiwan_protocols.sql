-- Additional managed WAN transports and an admin-scoped shared OVPN profile.
-- Safe to replay during deployment.
alter table public.isp_router_load_balancing_wans
  add column if not exists vlan_id integer;
alter table public.isp_router_load_balancing_wans
  add column if not exists underlay_wan_position integer;

alter table public.isp_router_load_balancing_wans
  drop constraint if exists isp_router_load_balancing_wans_connection_type_check;
alter table public.isp_router_load_balancing_wans
  add constraint isp_router_load_balancing_wans_connection_type_check
  check (connection_type in ('static', 'pppoe', 'dhcp', 'existing', 'ovpn'));
alter table public.isp_router_load_balancing_wans
  drop constraint if exists isp_router_load_balancing_wans_vlan_id_check;
alter table public.isp_router_load_balancing_wans
  add constraint isp_router_load_balancing_wans_vlan_id_check
  check (vlan_id is null or vlan_id between 1 and 4094);
alter table public.isp_router_load_balancing_wans
  drop constraint if exists isp_router_load_balancing_wans_underlay_wan_position_check;
alter table public.isp_router_load_balancing_wans
  add constraint isp_router_load_balancing_wans_underlay_wan_position_check
  check (underlay_wan_position is null or underlay_wan_position between 0 and 3);

alter table public.isp_router_load_balancing_wans
  drop constraint if exists isp_router_load_balancing_wans_load_balancing_id_interface_name_key;
create unique index if not exists isp_router_load_balancing_wans_interface_vlan_uidx
  on public.isp_router_load_balancing_wans (
    load_balancing_id,
    interface_name,
    (coalesce(vlan_id, 0))
  );

create table if not exists public.isp_admin_openvpn_wan_profiles (
  admin_id             bigint primary key references public.isp_admins(id) on delete cascade,
  profile_ciphertext   text not null,
  profile_iv           text not null,
  profile_auth_tag     text not null,
  updated_at           timestamptz not null default now()
);

alter table public.isp_admin_openvpn_wan_profiles enable row level security;
revoke all on public.isp_admin_openvpn_wan_profiles from anon, authenticated;
grant all on public.isp_admin_openvpn_wan_profiles to service_role;

create or replace function public.save_isp_router_load_balancing(
  p_admin_id bigint,
  p_router_id bigint,
  p_payload jsonb
) returns table(id bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_config_id bigint;
  v_wan_id bigint;
  v_wan jsonb;
  v_lan jsonb;
begin
  insert into public.isp_router_load_balancing (
    admin_id, router_id, enabled, lan_interface, router_os_version, mode,
    allow_bridge_firewall, bridge_firewall_original, updated_at
  ) values (
    p_admin_id, p_router_id,
    coalesce((p_payload->>'enabled')::boolean, false),
    coalesce(nullif(p_payload->>'lanInterface', ''), 'bridge'),
    coalesce(nullif(p_payload->>'routerOsVersion', ''), 'auto'),
    coalesce(nullif(p_payload->>'mode', ''), 'weighted'),
    coalesce((p_payload->>'allowBridgeFirewall')::boolean, false),
    nullif(p_payload->>'bridgeFirewallOriginal', '')::boolean,
    now()
  )
  on conflict (admin_id, router_id) do update set
    enabled = excluded.enabled,
    lan_interface = excluded.lan_interface,
    router_os_version = excluded.router_os_version,
    mode = excluded.mode,
    allow_bridge_firewall = excluded.allow_bridge_firewall,
    bridge_firewall_original = excluded.bridge_firewall_original,
    updated_at = now()
  returning isp_router_load_balancing.id into v_config_id;

  delete from public.isp_router_load_balancing_lans
    where load_balancing_id = v_config_id;
  delete from public.isp_router_load_balancing_wans
    where load_balancing_id = v_config_id;

  for v_wan in select value from jsonb_array_elements(coalesce(p_payload->'wans', '[]'::jsonb))
  loop
    insert into public.isp_router_load_balancing_wans (
      load_balancing_id, admin_id, name, interface_name, gateway, weight,
      health_check_ip, enabled, position, connection_type, static_address_cidr,
      vlan_id, underlay_wan_position, pppoe_username, pppoe_secret_ciphertext,
      pppoe_secret_iv, pppoe_secret_auth_tag, reassign_from_bridge, bridge_name, updated_at
    ) values (
      v_config_id, p_admin_id, v_wan->>'name', v_wan->>'interfaceName',
      nullif(v_wan->>'gateway', '')::inet,
      coalesce((v_wan->>'weight')::integer, 1),
      (v_wan->>'healthCheckIp')::inet,
      coalesce((v_wan->>'enabled')::boolean, true),
      coalesce((v_wan->>'position')::integer, 0),
      coalesce(nullif(v_wan->>'connectionType', ''), 'static'),
      nullif(v_wan->>'staticAddressCidr', ''),
      nullif(v_wan->>'vlanId', '')::integer,
      nullif(v_wan->>'underlayWanPosition', '')::integer,
      nullif(v_wan->>'pppoeUsername', ''),
      nullif(v_wan->>'pppoeSecretCiphertext', ''),
      nullif(v_wan->>'pppoeSecretIv', ''),
      nullif(v_wan->>'pppoeSecretAuthTag', ''),
      coalesce((v_wan->>'reassignFromBridge')::boolean, false),
      nullif(v_wan->>'bridgeName', ''),
      now()
    );
  end loop;

  for v_lan in select value from jsonb_array_elements(coalesce(p_payload->'lanLinks', '[]'::jsonb))
  loop
    select id into v_wan_id
      from public.isp_router_load_balancing_wans
      where load_balancing_id = v_config_id
        and position = (v_lan->>'wanPosition')::integer
      limit 1;
    if v_wan_id is null then
      raise exception 'LAN link refers to a missing WAN position';
    end if;
    insert into public.isp_router_load_balancing_lans (
      load_balancing_id, admin_id, interface_name, wan_id, max_mbps,
      position, updated_at
    ) values (
      v_config_id, p_admin_id, v_lan->>'interfaceName', v_wan_id,
      (v_lan->>'maxMbps')::integer,
      coalesce((v_lan->>'position')::integer, 0),
      now()
    );
  end loop;

  return query select v_config_id;
end;
$$;

revoke all on function public.save_isp_router_load_balancing(bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_isp_router_load_balancing(bigint, bigint, jsonb) to service_role;

notify pgrst, 'reload schema';