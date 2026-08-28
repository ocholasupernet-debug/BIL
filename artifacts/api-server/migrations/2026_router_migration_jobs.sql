-- Encrypted, tenant-owned RouterOS migration packages.  Packages are never
-- exposed to clients; only server service-role endpoints decrypt them.
create table if not exists router_migration_jobs (
  id bigserial primary key,
  admin_id bigint not null references isp_admins(id) on delete cascade,
  source_router_id bigint references isp_routers(id) on delete restrict,
  target_router_id bigint references isp_routers(id) on delete restrict,
  source_label text,
  source_mode text not null default 'connected_router' check (source_mode in ('connected_router', 'terminal_script')),
  status text not null default 'exported' check (status in ('exported','target_selected','dry_run','importing','completed','failed')),
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  findings_json jsonb not null default '{}'::jsonb,
  plan_json jsonb not null default '{}'::jsonb,
  stages_json jsonb not null default '{}'::jsonb,
  verification_json jsonb not null default '{}'::jsonb,
  audit_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint router_migration_jobs_distinct_routers check (target_router_id is null or target_router_id <> source_router_id)
);
-- Existing installations used a connected router as the source. Terminal
-- collection sources are intentionally not rows in isp_routers because they
-- have no host or router credentials in the web app.
alter table router_migration_jobs alter column source_router_id drop not null;
alter table router_migration_jobs add column if not exists source_label text;
alter table router_migration_jobs add column if not exists source_mode text not null default 'connected_router';
alter table router_migration_jobs drop constraint if exists router_migration_jobs_source_mode_check;
alter table router_migration_jobs add constraint router_migration_jobs_source_mode_check check (source_mode in ('connected_router', 'terminal_script', 'domain_collector'));
create index if not exists router_migration_jobs_admin_created_idx on router_migration_jobs(admin_id, created_at desc);
create index if not exists router_migration_jobs_source_idx on router_migration_jobs(source_router_id);
create index if not exists router_migration_jobs_target_idx on router_migration_jobs(target_router_id);
alter table router_migration_jobs enable row level security;
revoke all on table router_migration_jobs from anon, authenticated;
grant select, insert, update on table router_migration_jobs to service_role;
grant usage, select on sequence router_migration_jobs_id_seq to service_role;

-- One-time bearer sessions let a source MikroTik upload its export without
-- receiving a browser/admin credential.
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
alter table router_migration_tunnel_leases enable row level security;
revoke all on table router_migration_tunnel_leases from anon, authenticated;
grant select, insert, update on table router_migration_tunnel_leases to service_role;
grant usage, select on sequence router_migration_tunnel_leases_id_seq to service_role;

create table if not exists router_migration_target_leases (
  target_router_id bigint primary key references isp_routers(id) on delete cascade,
  admin_id bigint not null references isp_admins(id) on delete cascade,
  migration_job_id bigint not null references router_migration_jobs(id) on delete cascade,
  lease_token text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table router_migration_target_leases enable row level security;
revoke all on table router_migration_target_leases from anon, authenticated;
grant select, insert, update, delete on table router_migration_target_leases to service_role;

create or replace function acquire_router_migration_target_lease(
  p_job_id bigint, p_admin_id bigint, p_target_router_id bigint, p_lease_token text
) returns table(acquired boolean)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from router_migration_jobs
    where id = p_job_id and admin_id = p_admin_id
      and target_router_id = p_target_router_id and status = 'dry_run'
  ) then return query select false; return; end if;
  delete from router_migration_target_leases where expires_at <= now();
  insert into router_migration_target_leases(target_router_id, admin_id, migration_job_id, lease_token, expires_at)
  values (p_target_router_id, p_admin_id, p_job_id, p_lease_token, now() + interval '1 hour')
  on conflict (target_router_id) do nothing;
  return query select exists (
    select 1 from router_migration_target_leases
    where target_router_id = p_target_router_id and migration_job_id = p_job_id and lease_token = p_lease_token
  );
end $$;

create or replace function release_router_migration_target_lease(
  p_job_id bigint, p_admin_id bigint, p_target_router_id bigint, p_lease_token text
) returns table(released boolean)
language plpgsql security definer set search_path = public
as $$
begin
  delete from router_migration_target_leases
  where target_router_id = p_target_router_id and admin_id = p_admin_id
    and migration_job_id = p_job_id and lease_token = p_lease_token;
  return query select found;
end $$;
create or replace function renew_router_migration_target_lease(
  p_job_id bigint, p_admin_id bigint, p_target_router_id bigint, p_lease_token text
) returns table(renewed boolean)
language plpgsql security definer set search_path = public
as $$
begin
  update router_migration_target_leases set expires_at = now() + interval '1 hour'
  where target_router_id = p_target_router_id and admin_id = p_admin_id
    and migration_job_id = p_job_id and lease_token = p_lease_token
    and expires_at > now();
  return query select found;
end $$;
revoke all on function acquire_router_migration_target_lease(bigint,bigint,bigint,text) from public;
revoke all on function release_router_migration_target_lease(bigint,bigint,bigint,text) from public;
revoke all on function renew_router_migration_target_lease(bigint,bigint,bigint,text) from public;
grant execute on function acquire_router_migration_target_lease(bigint,bigint,bigint,text) to service_role;
grant execute on function release_router_migration_target_lease(bigint,bigint,bigint,text) to service_role;
grant execute on function renew_router_migration_target_lease(bigint,bigint,bigint,text) to service_role;
create or replace function router_migration_jobs_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists router_migration_jobs_updated_at on router_migration_jobs;
create trigger router_migration_jobs_updated_at before update on router_migration_jobs for each row execute function router_migration_jobs_touch_updated_at();