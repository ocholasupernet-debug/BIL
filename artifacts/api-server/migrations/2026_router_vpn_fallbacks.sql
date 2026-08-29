-- Permanent router-management fallback state. Secret values remain encrypted
-- in router_vpn_fallback_secrets and are never exposed through REST reads.
create table if not exists router_vpn_fallbacks (
  id bigserial primary key,
  admin_id bigint not null references isp_admins(id) on delete cascade,
  router_id bigint not null references isp_routers(id) on delete cascade,
  technology text not null check (technology in ('wireguard', 'ipsec')),
  endpoint text not null,
  endpoint_port integer,
  assigned_ip inet not null,
  server_public_key text,
  client_public_key text,
  server_reference text,
  status text not null default 'pending'
    check (status in ('pending', 'provisioning', 'ready', 'failed')),
  last_error text,
  status_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (router_id, technology)
);

create index if not exists router_vpn_fallbacks_admin_idx
  on router_vpn_fallbacks(admin_id);
create index if not exists router_vpn_fallbacks_router_idx
  on router_vpn_fallbacks(router_id);
alter table router_vpn_fallbacks enable row level security;
revoke all on table router_vpn_fallbacks from anon, authenticated;
grant select, insert, update, delete on table router_vpn_fallbacks to service_role;

create table if not exists router_vpn_fallback_secrets (
  fallback_id bigint primary key references router_vpn_fallbacks(id) on delete cascade,
  secret_type text not null check (secret_type in ('private_key', 'psk')),
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table router_vpn_fallback_secrets enable row level security;
revoke all on table router_vpn_fallback_secrets from anon, authenticated;
grant select, insert, update, delete on table router_vpn_fallback_secrets to service_role;