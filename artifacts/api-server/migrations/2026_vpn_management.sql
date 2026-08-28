-- Additive VPN management schema. All secret material is encrypted by the API
-- with SESSION_SECRET before it reaches these service-role-only tables.
alter table if exists isp_routers add column if not exists last_connected_host text;

create table if not exists isp_vpn_servers (
  id bigserial primary key,
  admin_id bigint not null references isp_admins(id) on delete cascade,
  router_id bigint not null references isp_routers(id) on delete cascade,
  technology text not null check (technology in ('wireguard','openvpn','ipsec')),
  name text not null,
  interface_name text,
  listen_port integer,
  address_pool cidr,
  endpoint text,
  dns_servers text[],
  settings_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  last_status text not null default 'unknown',
  last_status_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (admin_id, router_id, technology, name)
);
create index if not exists isp_vpn_servers_admin_idx on isp_vpn_servers(admin_id);
create index if not exists isp_vpn_servers_router_idx on isp_vpn_servers(router_id);

create table if not exists isp_vpn_peers (
  id bigserial primary key,
  admin_id bigint not null references isp_admins(id) on delete cascade,
  server_id bigint not null references isp_vpn_servers(id) on delete cascade,
  customer_id bigint references isp_customers(id) on delete set null,
  username text not null,
  technology text not null check (technology in ('wireguard','openvpn','ipsec')),
  router_ref text,
  public_key text,
  assigned_ip inet,
  allowed_ips text[] not null default '{}',
  endpoint text,
  settings_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  expires_at timestamptz,
  last_handshake_at timestamptz,
  last_status text not null default 'unknown',
  last_status_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (server_id, username)
);
create index if not exists isp_vpn_peers_admin_idx on isp_vpn_peers(admin_id);
create index if not exists isp_vpn_peers_server_idx on isp_vpn_peers(server_id);
create index if not exists isp_vpn_peers_customer_idx on isp_vpn_peers(customer_id);

create table if not exists isp_vpn_secrets (
  peer_id bigint primary key references isp_vpn_peers(id) on delete cascade,
  secret_type text not null check (secret_type in ('private_key','psk','password','certificate_bundle')),
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table isp_vpn_secrets enable row level security;
revoke all on table isp_vpn_secrets from anon, authenticated;
grant select, insert, update, delete on table isp_vpn_secrets to service_role;

create table if not exists isp_vpn_operations (
  id bigserial primary key,
  admin_id bigint not null references isp_admins(id) on delete cascade,
  router_id bigint references isp_routers(id) on delete set null,
  server_id bigint references isp_vpn_servers(id) on delete set null,
  peer_id bigint references isp_vpn_peers(id) on delete set null,
  technology text not null check (technology in ('wireguard','openvpn','ipsec')),
  operation text not null,
  mode text not null check (mode in ('dry_run','apply')),
  stage text not null default 'requested',
  status text not null default 'started' check (status in ('started','succeeded','failed')),
  request_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists isp_vpn_operations_admin_idx on isp_vpn_operations(admin_id, created_at desc);
create index if not exists isp_vpn_operations_router_idx on isp_vpn_operations(router_id, created_at desc);
alter table isp_vpn_operations enable row level security;
revoke all on table isp_vpn_operations from anon, authenticated;
grant select, insert, update on table isp_vpn_operations to service_role;

-- Existing accounts can be linked to the new control plane without changing
-- their legacy credential format or billing data.
alter table isp_vpn_users add column if not exists customer_id bigint references isp_customers(id) on delete set null;
alter table isp_vpn_users add column if not exists server_id bigint references isp_vpn_servers(id) on delete set null;
create index if not exists isp_vpn_users_customer_idx on isp_vpn_users(customer_id);
create index if not exists isp_vpn_users_server_idx on isp_vpn_users(server_id);

-- Short-lived, source-router management tunnels used only during migration.
create table if not exists router_migration_tunnel_leases (
  id bigserial primary key,
  admin_id bigint not null references isp_admins(id) on delete cascade,
  source_router_id bigint not null references isp_routers(id) on delete cascade,
  migration_job_id bigint references router_migration_jobs(id) on delete set null,
  technology text not null check (technology = 'openvpn'),
  username text not null unique,
  assigned_ip inet not null unique,
  server_endpoint text not null,
  bootstrap_token_hash text not null unique,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  status text not null default 'issued' check (status in ('issued','script_issued','connected','exported','revoked','expired','server_unavailable')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  bootstrap_fetched_at timestamptz,
  verified_at timestamptz,
  revoked_at timestamptz,
  audit_json jsonb not null default '{}'::jsonb
);
create unique index if not exists router_migration_tunnel_active_source_idx
  on router_migration_tunnel_leases(admin_id, source_router_id)
  where status in ('issued','script_issued','connected','exported');
create index if not exists router_migration_tunnel_expiry_idx
  on router_migration_tunnel_leases(status, expires_at);
alter table if exists router_migration_collector_tokens
  add column if not exists tunnel_lease_id bigint references router_migration_tunnel_leases(id) on delete set null;
alter table router_migration_tunnel_leases enable row level security;
revoke all on table router_migration_tunnel_leases from anon, authenticated;
grant select, insert, update on table router_migration_tunnel_leases to service_role;
grant usage, select on sequence router_migration_tunnel_leases_id_seq to service_role;