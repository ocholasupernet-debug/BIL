-- Tenant-scoped multi-WAN load-balancing settings for MikroTik routers.
-- Safe to replay during deployment.
create table if not exists public.isp_router_load_balancing (
  id                 bigserial primary key,
  admin_id           bigint not null references public.isp_admins(id) on delete cascade,
  router_id          bigint not null references public.isp_routers(id) on delete cascade,
  enabled            boolean not null default false,
  lan_interface      text not null default 'bridge',
  router_os_version  text not null default 'auto'
    check (router_os_version in ('auto', '6', '7')),
  mode               text not null default 'weighted'
    check (mode in ('weighted', 'failover')),
  allow_bridge_firewall boolean not null default false,
  bridge_firewall_original boolean,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (admin_id, router_id)
);

alter table public.isp_router_load_balancing
  add column if not exists mode text not null default 'weighted';
alter table public.isp_router_load_balancing
  add column if not exists allow_bridge_firewall boolean not null default false;
alter table public.isp_router_load_balancing
  add column if not exists bridge_firewall_original boolean;
alter table public.isp_router_load_balancing
  drop constraint if exists isp_router_load_balancing_mode_check;
alter table public.isp_router_load_balancing
  add constraint isp_router_load_balancing_mode_check check (mode in ('weighted', 'failover'));

create table if not exists public.isp_router_load_balancing_wans (
  id                   bigserial primary key,
  load_balancing_id    bigint not null references public.isp_router_load_balancing(id) on delete cascade,
  admin_id             bigint not null references public.isp_admins(id) on delete cascade,
  name                 text not null,
  interface_name       text not null,
  gateway              inet,
  weight               integer not null default 1 check (weight between 1 and 100),
  health_check_ip      inet not null,
  enabled              boolean not null default true,
  position             integer not null default 0 check (position between 0 and 3),
  connection_type      text not null default 'static'
    check (connection_type in ('static', 'pppoe')),
  static_address_cidr  text,
  pppoe_username       text,
  pppoe_secret_ciphertext text,
  pppoe_secret_iv      text,
  pppoe_secret_auth_tag text,
  reassign_from_bridge boolean not null default false,
  bridge_name          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (load_balancing_id, interface_name),
  unique (load_balancing_id, position),
  unique (load_balancing_id, health_check_ip)
);

alter table public.isp_router_load_balancing_wans
  alter column gateway drop not null;
alter table public.isp_router_load_balancing_wans
  add column if not exists connection_type text not null default 'static';
alter table public.isp_router_load_balancing_wans
  add column if not exists static_address_cidr text;
alter table public.isp_router_load_balancing_wans
  add column if not exists pppoe_username text;
alter table public.isp_router_load_balancing_wans
  add column if not exists pppoe_secret_ciphertext text;
alter table public.isp_router_load_balancing_wans
  add column if not exists pppoe_secret_iv text;
alter table public.isp_router_load_balancing_wans
  add column if not exists pppoe_secret_auth_tag text;
alter table public.isp_router_load_balancing_wans
  add column if not exists reassign_from_bridge boolean not null default false;
alter table public.isp_router_load_balancing_wans
  add column if not exists bridge_name text;
alter table public.isp_router_load_balancing_wans
  drop constraint if exists isp_router_load_balancing_wans_connection_type_check;
alter table public.isp_router_load_balancing_wans
  add constraint isp_router_load_balancing_wans_connection_type_check
  check (connection_type in ('static', 'pppoe'));

create table if not exists public.isp_router_load_balancing_lans (
  id                 bigserial primary key,
  load_balancing_id  bigint not null references public.isp_router_load_balancing(id) on delete cascade,
  admin_id           bigint not null references public.isp_admins(id) on delete cascade,
  interface_name     text not null,
  wan_id             bigint not null references public.isp_router_load_balancing_wans(id) on delete cascade,
  max_mbps           integer not null check (max_mbps between 1 and 100000),
  position           integer not null default 0 check (position between 0 and 31),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (load_balancing_id, interface_name),
  unique (load_balancing_id, position)
);

create table if not exists public.isp_router_load_balancing_recovery (
  id                    bigserial primary key,
  admin_id              bigint not null references public.isp_admins(id) on delete cascade,
  router_id             bigint not null references public.isp_routers(id) on delete cascade,
  script_ciphertext     text not null,
  script_iv             text not null,
  script_auth_tag        text not null,
  previous_config       jsonb not null default '{}'::jsonb,
  expires_at             timestamptz not null,
  created_at             timestamptz not null default now(),
  unique (admin_id, router_id)
);

create index if not exists isp_router_load_balancing_admin_id_idx
  on public.isp_router_load_balancing(admin_id);
create index if not exists isp_router_load_balancing_router_id_idx
  on public.isp_router_load_balancing(router_id);
create index if not exists isp_router_load_balancing_wans_config_id_idx
  on public.isp_router_load_balancing_wans(load_balancing_id);
create index if not exists isp_router_load_balancing_lans_config_id_idx
  on public.isp_router_load_balancing_lans(load_balancing_id);

alter table public.isp_router_load_balancing enable row level security;
alter table public.isp_router_load_balancing_wans enable row level security;
alter table public.isp_router_load_balancing_lans enable row level security;
alter table public.isp_router_load_balancing_recovery enable row level security;
revoke all on public.isp_router_load_balancing from anon, authenticated;
revoke all on public.isp_router_load_balancing_wans from anon, authenticated;
revoke all on public.isp_router_load_balancing_lans from anon, authenticated;
revoke all on public.isp_router_load_balancing_recovery from anon, authenticated;
grant all on public.isp_router_load_balancing to service_role;
grant all on public.isp_router_load_balancing_wans to service_role;
grant all on public.isp_router_load_balancing_lans to service_role;
grant all on public.isp_router_load_balancing_recovery to service_role;
grant usage, select on sequence public.isp_router_load_balancing_id_seq to service_role;
grant usage, select on sequence public.isp_router_load_balancing_wans_id_seq to service_role;
grant usage, select on sequence public.isp_router_load_balancing_lans_id_seq to service_role;
grant usage, select on sequence public.isp_router_load_balancing_recovery_id_seq to service_role;

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
      pppoe_username, pppoe_secret_ciphertext, pppoe_secret_iv,
      pppoe_secret_auth_tag, reassign_from_bridge, bridge_name, updated_at
    ) values (
      v_config_id, p_admin_id, v_wan->>'name', v_wan->>'interfaceName',
      nullif(v_wan->>'gateway', '')::inet,
      coalesce((v_wan->>'weight')::integer, 1),
      (v_wan->>'healthCheckIp')::inet,
      coalesce((v_wan->>'enabled')::boolean, true),
      coalesce((v_wan->>'position')::integer, 0),
      coalesce(nullif(v_wan->>'connectionType', ''), 'static'),
      nullif(v_wan->>'staticAddressCidr', ''),
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