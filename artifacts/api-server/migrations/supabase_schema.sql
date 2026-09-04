-- OcholaSupernet / ISPlatty — complete Supabase schema
-- Run once against your Supabase project:
--   psql "$DATABASE_URL" -f supabase_schema.sql
-- All statements use CREATE … IF NOT EXISTS so they are safe to re-run.

-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Global Daraja settings are encrypted by the API before storage.
create table if not exists platform_secure_settings (
  id         text primary key,
  ciphertext text not null,
  iv         text not null,
  auth_tag   text not null,
  updated_at timestamptz not null default now(),
  constraint platform_secure_settings_single_global
    check (id = 'global_daraja')
);
alter table platform_secure_settings enable row level security;

revoke all on table platform_secure_settings from anon, authenticated;
grant select, insert, update on table platform_secure_settings to service_role;

-- Platform-wide visibility controls for ISP Admin Panel modules and pages.
-- The API applies the safe defaults when a row is missing.
create table if not exists admin_page_visibility (
  feature_key text primary key,
  enabled boolean not null default true,
  updated_by text not null default 'system',
  updated_at timestamptz not null default now()
);
alter table admin_page_visibility enable row level security;
revoke all on table admin_page_visibility from anon, authenticated;
grant select, insert, update on table admin_page_visibility to service_role;

insert into admin_page_visibility (feature_key, enabled)
values
  ('overview', true), ('overview.dashboard', true),
  ('customers', true), ('customers.customers', true), ('customers.activation', true),
  ('customers.vouchers', true), ('customers.hotspot-binding', true),
  ('billing', true), ('billing.plans', true), ('billing.transactions', true),
  ('network', true), ('network.routers', true), ('network.self-install', true),
  ('network.replace-router', true), ('network.migration', true), ('network.pppoe', true),
  ('network.ppp', true), ('network.wireless', true), ('network.queues', true),
  ('network.ip-pools', true), ('network.router-api-config', true), ('network.files', true),
  ('network.bridge-ports', true), ('network.access-points', true),
  ('network.pppoe-settings', true), ('network.hotspot-settings', true),
  ('tools', true), ('tools.vpn', true), ('tools.bulk', true), ('tools.uisp', true),
  ('tools.bonga', true), ('tools.webhooks', true), ('tools.acs', true), ('tools.page-builder', true),
  ('admin', true), ('admin.support', true), ('admin.notifications', true), ('admin.logs', true),
  ('admin.extras', true), ('admin.radius', true), ('admin.settings', true), ('admin.pages', true)
on conflict (feature_key) do nothing;

-- ══════════════════════════════════════════════════════════════════════════════
-- CORE ISP TABLES
-- ══════════════════════════════════════════════════════════════════════════════

-- ISP admin accounts (one per ISP / tenant)
create table if not exists isp_admins (
  id              bigserial primary key,
  name            text not null,
  username        text,
  fullname        text,
  email           text,
  phone           text,
  payment_phone   text,
  subdomain       text unique,
  password        text,
  must_change_password boolean not null default false,
  is_active       boolean not null default true,
  role            text not null default 'isp_admin',
  area            text,                               -- country name (e.g. "Kenya")
  currency        text not null default 'KES',        -- ISO 4217 currency code
  payment_gateway text not null default 'mpesa_paybill',
  payment_gateway_config jsonb not null default '{}'::jsonb,
  payment_collection_mode text not null default 'shared'
    check (payment_collection_mode in ('shared', 'separate')),
  payment_service_config jsonb not null default '{}'::jsonb,
  status          text not null default 'active',
  plan_name       text,
  wallet_balance  numeric(12,2) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.isp_admins
  add column if not exists font_family text not null default 'DM Sans',
  add column if not exists font_style text not null default 'normal',
  add column if not exists font_weight integer not null default 500,
  add column if not exists font_size integer not null default 18;
create unique index if not exists isp_admins_subdomain_username_key
  on isp_admins(subdomain, username)
  where username is not null;
alter table isp_admins
  add constraint isp_admins_reserved_subdomain_check
  check (
    subdomain is null
    or lower(subdomain) not in ('www', 'api', 'vpn', 'register', 'proxyvpn', 'mail', 'admin')
  ) not valid;
create index if not exists isp_admins_subdomain_idx on isp_admins(subdomain);
create index if not exists isp_admins_username_idx  on isp_admins(username);

-- Per-ISP dashboard appearance preferences.
create table if not exists isp_dashboard_preferences (
  admin_id     bigint primary key references isp_admins(id) on delete cascade,
  accent_color text not null default '#d96835',
  layout       text not null default 'balanced'
    check (layout in ('balanced', 'focus', 'compact')),
  card_shape   text not null default 'rounded'
    check (card_shape in ('rounded', 'soft-square', 'compact', 'square', 'circle', 'star', 'triangle', 'diamond', 'hexagon', 'octagon', 'pill', 'leaf', 'arch', 'bevel', 'notched', 'ticket', 'squircle')),
  hide_amounts boolean not null default false,
  updated_at   timestamptz not null default now()
);
alter table isp_dashboard_preferences enable row level security;
revoke all on table isp_dashboard_preferences from anon, authenticated;
grant select, insert, update on table isp_dashboard_preferences to service_role;

-- Internet service plans
create table if not exists isp_plans (
  id             bigserial primary key,
  admin_id       bigint not null references isp_admins(id) on delete cascade,
  name           text not null,
  type           text not null default 'hotspot',   -- hotspot | pppoe | static
  speed_down     numeric(10,2) not null default 10, -- Mbps
  speed_up       numeric(10,2) not null default 10, -- Mbps
  price          numeric(12,2) not null default 0,
  validity       integer not null default 30,
  validity_unit  text not null default 'days',
  validity_days  integer not null default 30,
  shared_users   integer not null default 1,
  description    text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists isp_plans_admin_id_idx on isp_plans(admin_id);

-- Reusable bandwidth profiles
create table if not exists isp_bandwidth (
  id              bigserial primary key,
  admin_id        bigint not null references isp_admins(id) on delete cascade,
  name            text not null,
  speed_down      numeric(10,2) not null check (speed_down > 0),
  speed_up        numeric(10,2) not null check (speed_up > 0),
  speed_down_unit text not null default 'Mbps'
    check (speed_down_unit in ('Kbps', 'Mbps', 'Gbps')),
  speed_up_unit   text not null default 'Mbps'
    check (speed_up_unit in ('Kbps', 'Mbps', 'Gbps')),
  burst_enabled   boolean not null default false,
  burst_down      numeric(10,2),
  burst_up        numeric(10,2),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists isp_bandwidth_admin_id_idx on isp_bandwidth(admin_id);

-- Subscribers / customers
create table if not exists isp_customers (
  id              bigserial primary key,
  admin_id        bigint not null references isp_admins(id) on delete cascade,
  name            text not null,
  phone           text not null,
  email           text,
  username        text,
  password        text,
  plan_id         bigint references isp_plans(id) on delete set null,
  type            text not null default 'hotspot',  -- hotspot | pppoe | static
  ip_address      text,
  mac_address     text,
  pppoe_username  text,
  status          text not null default 'active',   -- active | suspended | expired
  expires_at      timestamptz,
  wallet_balance  numeric(12,2) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists isp_customers_admin_id_idx   on isp_customers(admin_id);
create index if not exists isp_customers_phone_idx      on isp_customers(phone);
create index if not exists isp_customers_username_idx   on isp_customers(username);
create index if not exists isp_customers_status_idx     on isp_customers(status);

-- MikroTik routers
create table if not exists isp_routers (
  id               bigserial primary key,
  admin_id         bigint not null references isp_admins(id) on delete cascade,
  name             text not null,
  host             text not null,
  ip_address       text,
  model            text,
  ros_version      text,
  router_username  text not null default 'admin',
  router_secret    text,
  token            text,
  bridge_ip        text,
  proxy_ip         text,
  bridge_interface text,
  status           text not null default 'offline',  -- online | offline | unreachable
  last_seen        timestamptz,
  last_connected_host text,
  router_uptime    text,
  uptime_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists isp_routers_admin_id_idx on isp_routers(admin_id);
create index if not exists isp_routers_status_idx   on isp_routers(status);

-- Stable OpenVPN management address for a MikroTik router. This is separate
-- from bridge_ip, which is the router's customer-LAN/captive-portal gateway.
alter table isp_routers add column if not exists vpn_ip text;
create unique index if not exists isp_routers_vpn_ip_unique_idx
  on isp_routers(vpn_ip) where vpn_ip is not null;
alter table isp_routers add column if not exists manual_vpn_config jsonb;

-- Encrypted RouterOS migration packages (service role only).
create table if not exists router_migration_jobs (
  id bigserial primary key,
  admin_id bigint not null references isp_admins(id) on delete cascade,
  source_router_id bigint references isp_routers(id) on delete restrict,
  target_router_id bigint references isp_routers(id) on delete restrict,
  source_label       text,
  source_mode       text not null default 'connected_router' check (source_mode in ('connected_router', 'terminal_script', 'domain_collector')),
  status text not null default 'exported',
  ciphertext text not null, iv text not null, auth_tag text not null,
  findings_json jsonb not null default '{}'::jsonb, plan_json jsonb not null default '{}'::jsonb,
  stages_json jsonb not null default '{}'::jsonb, verification_json jsonb not null default '{}'::jsonb,
  audit_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
  constraint router_migration_jobs_distinct_routers check (target_router_id is null or target_router_id <> source_router_id)
);
create index if not exists router_migration_jobs_admin_created_idx on router_migration_jobs(admin_id, created_at desc);
alter table router_migration_jobs enable row level security;
revoke all on table router_migration_jobs from anon, authenticated;
grant select, insert, update on table router_migration_jobs to service_role;
grant usage, select on sequence router_migration_jobs_id_seq to service_role;

-- One-time domain collector sessions. The token is stored only as a hash;
-- the complete source export remains in the encrypted migration job.
create table if not exists router_migration_collector_tokens (
  token_hash text primary key,
  admin_id bigint not null references isp_admins(id) on delete cascade,
  source_label text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  migration_job_id bigint references router_migration_jobs(id) on delete set null
);
create index if not exists router_migration_collector_tokens_admin_idx
  on router_migration_collector_tokens(admin_id, expires_at);
alter table router_migration_collector_tokens enable row level security;
revoke all on table router_migration_collector_tokens from anon, authenticated;
grant select, insert, update on table router_migration_collector_tokens to service_role;

create table if not exists router_migration_collector_chunks (
  token_hash text not null references router_migration_collector_tokens(token_hash) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0 and chunk_index <= 2500),
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  primary key (token_hash, chunk_index)
);
alter table router_migration_collector_chunks enable row level security;
revoke all on table router_migration_collector_chunks from anon, authenticated;
grant select, insert on table router_migration_collector_chunks to service_role;

create or replace function consume_router_migration_collector_token(p_token_hash text)
returns table(admin_id bigint, source_label text)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  update router_migration_collector_tokens
     set used_at = now()
   where token_hash = p_token_hash
     and used_at is null
     and expires_at > now()
  returning router_migration_collector_tokens.admin_id,
            router_migration_collector_tokens.source_label;
end $$;
revoke all on function consume_router_migration_collector_token(text) from public;
grant execute on function consume_router_migration_collector_token(text) to service_role;

-- Short-lived, source-router management tunnels used only during migration.
-- The credential payload is encrypted by the API; the raw password never
-- reaches the database or an audit record.
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
alter table router_migration_collector_tokens
  add column if not exists tunnel_lease_id bigint references router_migration_tunnel_leases(id) on delete set null;
alter table router_migration_tunnel_leases enable row level security;
revoke all on table router_migration_tunnel_leases from anon, authenticated;
grant select, insert, update on table router_migration_tunnel_leases to service_role;
grant usage, select on sequence router_migration_tunnel_leases_id_seq to service_role;

-- One expiring, database-enforced import lease per target router prevents
-- separate API processes from interleaving migration writes.
create table if not exists router_migration_target_leases (
  target_router_id bigint primary key references isp_routers(id) on delete cascade,
  admin_id bigint not null references isp_admins(id) on delete cascade,
  migration_job_id bigint not null references router_migration_jobs(id) on delete cascade,
  lease_token text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Payment / billing transactions
create table if not exists isp_transactions (
  id              bigserial primary key,
  admin_id        bigint not null references isp_admins(id) on delete cascade,
  customer_id     bigint references isp_customers(id) on delete set null,
  plan_id         bigint references isp_plans(id) on delete set null,
  amount          numeric(12,2) not null,
  payment_method  text not null default 'mpesa',  -- mpesa | cash | stripe | flutterwave
  payment_phone   text,
  mac_address     text,
  mpesa_receipt   text,
  merchant_request_id text,
  reference       text,
  status          text not null default 'completed',  -- pending | completed | failed
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists isp_transactions_admin_id_idx    on isp_transactions(admin_id);
create index if not exists isp_transactions_customer_id_idx on isp_transactions(customer_id);
create index if not exists isp_transactions_reference_idx   on isp_transactions(reference);
create unique index if not exists isp_transactions_pending_mpesa_reference_idx
  on isp_transactions(reference)
  where reference is not null and status = 'pending' and payment_method like 'mpesa%';

create or replace function public.settle_verified_mpesa_transaction(
  p_transaction_id bigint,
  p_status text,
  p_note text
)
returns table (
  settled boolean,
  payment_method text,
  admin_id bigint,
  amount numeric,
  credited_customer_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  tx isp_transactions%rowtype;
  customer_id_to_credit bigint;
  normalized_phone text;
begin
  if p_status not in ('completed', 'failed') then
    raise exception 'Unsupported settlement status';
  end if;
  select * into tx from isp_transactions
  where id = p_transaction_id and status = 'pending'
  for update;
  if not found then
    return query select false, null::text, null::bigint, null::numeric, null::bigint;
    return;
  end if;
  update isp_transactions set status = p_status, notes = p_note where id = tx.id;
  if p_status = 'failed' then
    if tx.payment_method = 'mpesa_registration' and tx.admin_id is not null then
      update isp_admins set status = 'payment_failed', updated_at = now() where id = tx.admin_id;
    end if;
    return query select true, tx.payment_method, tx.admin_id, tx.amount, null::bigint;
    return;
  end if;
  if tx.customer_id is not null and tx.plan_id is not null then
    update isp_customers as c
       set plan_id = tx.plan_id,
           status = 'active',
           expires_at = now() + make_interval(days => greatest(coalesce((
             select p.validity_days from isp_plans as p
              where p.id = tx.plan_id and p.admin_id = tx.admin_id
           ), 1), 1)),
           updated_at = now()
     where c.id = tx.customer_id
       and c.admin_id = tx.admin_id
       and c.type = 'pppoe'
       and exists (
         select 1 from isp_plans as active_plan
          where active_plan.id = tx.plan_id
            and active_plan.admin_id = tx.admin_id
            and active_plan.is_active = true
            and lower(coalesce(active_plan.type, '')) = 'pppoe'
       );
  end if;
  if tx.payment_method in ('mpesa_registration', 'manual_registration') and tx.admin_id is not null then
    update isp_admins set is_active = true, status = 'active', updated_at = now() where id = tx.admin_id;
    return query select true, tx.payment_method, tx.admin_id, tx.amount, null::bigint;
    return;
  end if;
  if tx.customer_id is null and tx.payment_phone is not null and tx.payment_phone <> '' then
    normalized_phone := regexp_replace(tx.payment_phone, '\D', '', 'g');
    select c.id into customer_id_to_credit from isp_customers as c
    where regexp_replace(c.phone, '\D', '', 'g') = normalized_phone
      and (tx.admin_id is null or c.admin_id = tx.admin_id)
    order by c.id limit 1 for update;
    if customer_id_to_credit is not null then
      update isp_customers
      set wallet_balance = wallet_balance + tx.amount,
          mac_address = coalesce(tx.mac_address, mac_address),
          updated_at = now()
      where id = customer_id_to_credit;
    end if;
  end if;
  return query select true, tx.payment_method, tx.admin_id, tx.amount, customer_id_to_credit;
end;
$$;

revoke all on function public.settle_verified_mpesa_transaction(bigint, text, text) from public;
grant execute on function public.settle_verified_mpesa_transaction(bigint, text, text) to service_role;

create function public.registration_payment_schema_version()
returns table (schema_version integer, payment_phone_available boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    1,
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'isp_admins'
        and column_name = 'payment_phone'
    );
$$;

revoke all on function public.registration_payment_schema_version() from public;
grant execute on function public.registration_payment_schema_version() to service_role;

notify pgrst, 'reload schema';
create index if not exists isp_transactions_created_at_idx  on isp_transactions(created_at desc);

-- Prepaid voucher / PIN codes
create table if not exists isp_vouchers (
  id          bigserial primary key,
  admin_id    bigint not null references isp_admins(id) on delete cascade,
  plan_id     bigint references isp_plans(id) on delete set null,
  code        text not null,
  batch_name  text,
  plan_name   text,
  duration    integer,   -- days
  price       numeric(12,2),
  status      text not null default 'unused',  -- unused | used | expired
  used_by     text,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists isp_vouchers_code_admin_idx on isp_vouchers(admin_id, code);
create index if not exists isp_vouchers_admin_id_idx          on isp_vouchers(admin_id);
create index if not exists isp_vouchers_status_idx            on isp_vouchers(status);

-- IP address pools (per router)
create table if not exists isp_ip_pools (
  id          bigserial primary key,
  admin_id    bigint not null references isp_admins(id) on delete cascade,
  router_id   bigint references isp_routers(id) on delete set null,
  name        text not null,
  range_start text not null,
  range_end   text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists isp_ip_pools_admin_id_idx  on isp_ip_pools(admin_id);
create index if not exists isp_ip_pools_router_id_idx on isp_ip_pools(router_id);

-- VPN user accounts (OpenVPN / WireGuard)
create table if not exists isp_vpn_users (
  id          bigserial primary key,
  admin_id    bigint not null references isp_admins(id) on delete cascade,
  username    text not null,
  password    text,
  notes       text,
  is_active   boolean not null default true,
  expires_at  timestamptz,
  assigned_ip text,
  vpn_type    text not null default 'openvpn',  -- openvpn | wireguard
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists isp_vpn_users_admin_id_idx on isp_vpn_users(admin_id);

-- Router-bound VPN control plane. Secret payloads are stored separately in
-- isp_vpn_secrets and encrypted by the API before insertion.
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

alter table isp_vpn_users add column if not exists customer_id bigint references isp_customers(id) on delete set null;
alter table isp_vpn_users add column if not exists server_id bigint references isp_vpn_servers(id) on delete set null;
create index if not exists isp_vpn_users_customer_idx on isp_vpn_users(customer_id);
create index if not exists isp_vpn_users_server_idx on isp_vpn_users(server_id);

-- PPPoE username/password secrets (mirrored from MikroTik)
create table if not exists isp_ppp_secrets (
  id          bigserial primary key,
  admin_id    bigint not null references isp_admins(id) on delete cascade,
  router_id   bigint references isp_routers(id) on delete set null,
  username    text not null,
  password    text,
  service     text not null default 'pppoe',  -- pppoe | l2tp | pptp
  profile     text,
  ip_address  text,
  comment     text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists isp_ppp_secrets_admin_id_idx on isp_ppp_secrets(admin_id);
create index if not exists isp_ppp_secrets_username_idx on isp_ppp_secrets(username);

-- Active PPPoE sessions (reported by MikroTik)
create table if not exists isp_pppoe_users (
  id          bigserial primary key,
  admin_id    bigint not null references isp_admins(id) on delete cascade,
  router_id   bigint references isp_routers(id) on delete set null,
  username    text not null,
  ip_address  text,
  mac_address text,
  uptime      text,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists isp_pppoe_users_admin_id_idx on isp_pppoe_users(admin_id);

-- Active hotspot sessions (reported by MikroTik)
create table if not exists isp_hotspot_users (
  id          bigserial primary key,
  admin_id    bigint not null references isp_admins(id) on delete cascade,
  router_id   bigint references isp_routers(id) on delete set null,
  username    text not null,
  ip_address  text,
  mac_address text,
  uptime      text,
  bytes_in    bigint default 0,
  bytes_out   bigint default 0,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists isp_hotspot_users_admin_id_idx on isp_hotspot_users(admin_id);

-- Router self-install timeline events
create table if not exists isp_router_install_events (
  id                 bigserial primary key,
  router_id          bigint not null,
  admin_id           bigint not null,
  router_name        text,
  install_started_at timestamptz not null,
  step               integer not null,
  step_name          text,
  phase              text not null,  -- downloading | applied | failed
  error              text,
  done               boolean not null default false,
  created_at         timestamptz not null default now()
);
create index if not exists isp_router_install_events_admin_router_idx
  on isp_router_install_events(admin_id, router_id, install_started_at desc);
create index if not exists isp_router_install_events_created_at_idx
  on isp_router_install_events(created_at desc);

-- Admin activity audit log
create table if not exists isp_activity_logs (
  id          bigserial primary key,
  admin_id    bigint not null,
  type        text not null,    -- router | plan | customer | provision | system
  action      text not null,    -- added | updated | deleted | …
  subject     text,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists isp_activity_logs_admin_id_idx  on isp_activity_logs(admin_id);
create index if not exists isp_activity_logs_created_at_idx on isp_activity_logs(created_at desc);

-- Incoming payment webhook events log
create table if not exists isp_webhook_events (
  id          bigserial primary key,
  gateway     text not null,   -- mpesa | stripe | flutterwave | generic
  status      text not null,   -- received | processed | ignored | error
  payload     jsonb,
  phone       text,
  amount      numeric(12,2),
  reference   text,
  created_at  timestamptz not null default now()
);
create index if not exists isp_webhook_events_gateway_idx    on isp_webhook_events(gateway);
create index if not exists isp_webhook_events_created_at_idx on isp_webhook_events(created_at desc);
create index if not exists isp_webhook_events_mpesa_received_idx
  on isp_webhook_events(gateway, status, created_at asc);

-- ══════════════════════════════════════════════════════════════════════════════
-- FREERADIUS TABLES (used by hotspot / PPPoE auth via RADIUS)
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists radcheck (
  id        bigserial primary key,
  username  text not null,
  attribute text not null,
  op        text not null default ':=',
  value     text not null
);
create index if not exists radcheck_username_idx on radcheck(username);

create table if not exists radreply (
  id        bigserial primary key,
  username  text not null,
  attribute text not null,
  op        text not null default ':=',
  value     text not null
);
create index if not exists radreply_username_idx on radreply(username);

create table if not exists radgroupreply (
  id         bigserial primary key,
  groupname  text not null,
  attribute  text not null,
  op         text not null default ':=',
  value      text not null,
  plan_id    bigint
);
create index if not exists radgroupreply_groupname_idx on radgroupreply(groupname);
create index if not exists radgroupreply_plan_id_idx   on radgroupreply(plan_id);

create table if not exists radusergroup (
  id         bigserial primary key,
  username   text not null,
  groupname  text not null,
  priority   integer not null default 1
);
create index if not exists radusergroup_username_idx on radusergroup(username);

create table if not exists radacct (
  radacctid        bigserial primary key,
  username         text not null,
  nasipaddress     text,
  framedipaddress  text,
  acctstoptime     timestamptz,
  acctsessiontime  bigint default 0,
  acctinputoctets  bigint default 0,
  acctoutputoctets bigint default 0,
  created_at       timestamptz not null default now()
);
create index if not exists radacct_username_idx on radacct(username);

create table if not exists nas (
  id          bigserial primary key,
  nasname     text not null,
  shortname   text not null,
  type        text not null default 'other',
  ports       text,
  secret      text not null,
  description text,
  server      text,
  community   text,
  routers     text
);
create index if not exists nas_nasname_idx on nas(nasname);

-- ══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (enable but leave open for service_role)
-- Uncomment and customise per-table once auth is wired up.
-- ══════════════════════════════════════════════════════════════════════════════
-- alter table isp_admins    enable row level security;
-- alter table isp_customers enable row level security;
-- alter table isp_plans     enable row level security;
-- alter table isp_routers   enable row level security;
-- …etc

-- Seed: default admin account (update credentials before going live)
insert into isp_admins (name, username, email, subdomain, status, plan_name)
values ('Default Admin', 'admin', 'admin@example.com', 'default', 'active', 'basic')
on conflict (username) do nothing;
