-- Tenant storage accounting and controlled cleanup governance.
-- This migration intentionally measures row payloads, not database indexes,
-- TOAST overhead, Supabase Storage buckets, or VPS disk usage.

create table if not exists platform_storage_settings (
  id             integer primary key default 1 check (id = 1),
  capacity_bytes bigint check (capacity_bytes is null or capacity_bytes >= 0),
  updated_by     text,
  updated_at     timestamptz not null default now()
);

insert into platform_storage_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists platform_storage_usage (
  admin_id     bigint not null references isp_admins(id) on delete cascade,
  source       text not null,
  bytes        bigint not null default 0 check (bytes >= 0),
  row_count    bigint not null default 0 check (row_count >= 0),
  measured_at  timestamptz not null default now(),
  primary key (admin_id, source)
);
create index if not exists platform_storage_usage_measured_idx
  on platform_storage_usage(measured_at desc);

create table if not exists platform_storage_cleanup_requests (
  id                bigserial primary key,
  admin_id          bigint not null references isp_admins(id) on delete restrict,
  scope             text not null check (scope in ('expired_migration_artifacts')),
  reason            text not null,
  requested_by      text not null,
  scheduled_for     timestamptz not null,
  candidate_bytes   bigint not null default 0 check (candidate_bytes >= 0),
  candidate_rows    bigint not null default 0 check (candidate_rows >= 0),
  candidate_ids     jsonb not null default '[]'::jsonb,
  status            text not null default 'pending'
    check (status in ('pending', 'processing', 'cancelled', 'completed', 'failed')),
  claimed_at        timestamptz,
  completed_at      timestamptz,
  failure_details   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists platform_storage_cleanup_due_idx
  on platform_storage_cleanup_requests(status, scheduled_for);
create index if not exists platform_storage_cleanup_admin_idx
  on platform_storage_cleanup_requests(admin_id, created_at desc);

create table if not exists platform_admin_notifications (
  id                   bigserial primary key,
  admin_id             bigint not null references isp_admins(id) on delete cascade,
  notification_type    text not null check (notification_type in ('storage_cleanup')),
  title                text not null,
  body                 text not null,
  cleanup_request_id   bigint references platform_storage_cleanup_requests(id) on delete cascade,
  metadata             jsonb not null default '{}'::jsonb,
  read_at              timestamptz,
  created_at           timestamptz not null default now()
);
create index if not exists platform_admin_notifications_admin_idx
  on platform_admin_notifications(admin_id, created_at desc);
create index if not exists platform_admin_notifications_request_idx
  on platform_admin_notifications(cleanup_request_id);

create table if not exists platform_storage_audit_logs (
  id                 bigserial primary key,
  cleanup_request_id bigint references platform_storage_cleanup_requests(id) on delete set null,
  admin_id           bigint references isp_admins(id) on delete set null,
  actor_type         text not null check (actor_type in ('super_admin', 'admin', 'system')),
  actor_id           text,
  action             text not null,
  details            jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);
create index if not exists platform_storage_audit_request_idx
  on platform_storage_audit_logs(cleanup_request_id, created_at desc);
create index if not exists platform_storage_audit_created_idx
  on platform_storage_audit_logs(created_at desc);

alter table platform_storage_settings enable row level security;
alter table platform_storage_usage enable row level security;
alter table platform_storage_cleanup_requests enable row level security;
alter table platform_admin_notifications enable row level security;
alter table platform_storage_audit_logs enable row level security;

revoke all on table platform_storage_settings from anon, authenticated;
revoke all on table platform_storage_usage from anon, authenticated;
revoke all on table platform_storage_cleanup_requests from anon, authenticated;
revoke all on table platform_admin_notifications from anon, authenticated;
revoke all on table platform_storage_audit_logs from anon, authenticated;
grant select, insert, update on table platform_storage_settings to service_role;
grant select, insert, update, delete on table platform_storage_usage to service_role;
grant select, insert, update, delete on table platform_storage_cleanup_requests to service_role;
grant select, insert, update, delete on table platform_admin_notifications to service_role;
grant select, insert on table platform_storage_audit_logs to service_role;
grant usage, select on sequence platform_storage_cleanup_requests_id_seq to service_role;
grant usage, select on sequence platform_admin_notifications_id_seq to service_role;
grant usage, select on sequence platform_storage_audit_logs_id_seq to service_role;

-- Return row-payload estimates for tenant-owned tables and explicitly
-- attributed protected/artifact tables. The function skips optional tables
-- that are not present in an older installation.
create or replace function public.platform_storage_measure()
returns table(admin_id bigint, source text, bytes bigint, row_count bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item record;
begin
  for item in
    select * from (values
      ('isp_plans', 'plans'),
      ('isp_bandwidth', 'bandwidth'),
      ('isp_customers', 'customers'),
      ('isp_routers', 'routers'),
      ('isp_transactions', 'transactions'),
      ('isp_vouchers', 'vouchers'),
      ('isp_ip_pools', 'ip_pools'),
      ('isp_vpn_users', 'vpn_users'),
      ('isp_vpn_servers', 'vpn_servers'),
      ('isp_vpn_peers', 'vpn_peers'),
      ('isp_vpn_operations', 'vpn_operations'),
      ('isp_ppp_secrets', 'ppp_secrets'),
      ('isp_pppoe_users', 'pppoe_users'),
      ('isp_hotspot_users', 'hotspot_users'),
      ('isp_router_install_events', 'router_install_events'),
      ('isp_activity_logs', 'activity_logs'),
      ('router_migration_jobs', 'migration_jobs'),
      ('router_migration_collector_tokens', 'migration_tokens'),
      ('router_migration_tunnel_leases', 'migration_tunnels'),
      ('router_vpn_fallbacks', 'vpn_fallbacks')
    ) as configured(table_name, source)
  loop
    if to_regclass(format('public.%I', item.table_name)) is not null then
      return query execute format(
        'select t.admin_id::bigint, %L::text, coalesce(sum(pg_column_size(to_jsonb(t))), 0)::bigint, count(*)::bigint
         from public.%I t
         group by t.admin_id',
        item.source,
        item.table_name
      );
    end if;
  end loop;

  if to_regclass('public.isp_vpn_secrets') is not null then
    return query
      select p.admin_id::bigint,
             'vpn_secrets'::text,
             coalesce(sum(pg_column_size(to_jsonb(s))), 0)::bigint,
             count(*)::bigint
      from public.isp_vpn_secrets s
      join public.isp_vpn_peers p on p.id = s.peer_id
      group by p.admin_id;
  end if;

  if to_regclass('public.router_vpn_fallback_secrets') is not null then
    return query
      select f.admin_id::bigint,
             'vpn_fallback_secrets'::text,
             coalesce(sum(pg_column_size(to_jsonb(s))), 0)::bigint,
             count(*)::bigint
      from public.router_vpn_fallback_secrets s
      join public.router_vpn_fallbacks f on f.id = s.fallback_id
      group by f.admin_id;
  end if;

  if to_regclass('public.router_migration_collector_chunks') is not null then
    return query
      select t.admin_id::bigint,
             'migration_chunks'::text,
             coalesce(sum(pg_column_size(to_jsonb(c))), 0)::bigint,
             count(*)::bigint
      from public.router_migration_collector_chunks c
      join public.router_migration_collector_tokens t on t.token_hash = c.token_hash
      group by t.admin_id;
  end if;
end;
$$;

revoke all on function public.platform_storage_measure() from public;
grant execute on function public.platform_storage_measure() to service_role;

create or replace function public.platform_storage_cleanup_candidates(p_admin_id bigint default null)
returns table(
  id bigint,
  admin_id bigint,
  source_label text,
  status text,
  created_at timestamptz,
  completed_at timestamptz,
  bytes bigint,
  row_count bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    j.id,
    j.admin_id,
    coalesce(nullif(j.source_label, ''), 'Router migration package') as source_label,
    j.status,
    j.created_at,
    j.completed_at,
    pg_column_size(to_jsonb(j))::bigint as bytes,
    1::bigint as row_count
  from public.router_migration_jobs j
  where (p_admin_id is null or j.admin_id = p_admin_id)
    and j.status in ('completed', 'failed')
    and j.created_at < now() - interval '30 days'
  order by j.created_at asc;
$$;

revoke all on function public.platform_storage_cleanup_candidates(bigint) from public;
grant execute on function public.platform_storage_cleanup_candidates(bigint) to service_role;

create or replace function public.platform_claim_due_storage_cleanup_requests(p_limit integer default 10)
returns table(id bigint)
language sql
security definer
set search_path = public, pg_temp
as $$
  with picked as (
    select r.id
    from public.platform_storage_cleanup_requests r
    where r.status = 'pending'
      and r.scheduled_for <= now()
    order by r.scheduled_for asc, r.id asc
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  update public.platform_storage_cleanup_requests r
  set status = 'processing',
      claimed_at = now(),
      updated_at = now()
  from picked
  where r.id = picked.id
  returning r.id;
$$;

revoke all on function public.platform_claim_due_storage_cleanup_requests(integer) from public;
grant execute on function public.platform_claim_due_storage_cleanup_requests(integer) to service_role;

create or replace function public.platform_execute_storage_cleanup(p_request_id bigint)
returns table(request_id bigint, deleted_rows bigint, deleted_bytes bigint, final_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.platform_storage_cleanup_requests%rowtype;
  candidate_id bigint;
  ids bigint[] := '{}'::bigint[];
  measured_bytes bigint := 0;
  measured_rows bigint := 0;
  token_bytes bigint := 0;
  token_rows bigint := 0;
  chunk_bytes bigint := 0;
  chunk_rows bigint := 0;
begin
  select * into request_row
  from public.platform_storage_cleanup_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Cleanup request not found';
  end if;

  if request_row.scope <> 'expired_migration_artifacts' then
    raise exception 'Cleanup scope is not supported';
  end if;

  if request_row.status in ('cancelled', 'completed') then
    return query select request_row.id, 0::bigint, 0::bigint, request_row.status;
    return;
  end if;

  if request_row.status not in ('pending', 'processing') then
    raise exception 'Cleanup request is not executable in its current state';
  end if;

  for candidate_id in
    select value::bigint
    from jsonb_array_elements_text(request_row.candidate_ids)
  loop
    ids := array_append(ids, candidate_id);
  end loop;

  select
    coalesce(sum(pg_column_size(to_jsonb(j))), 0)::bigint,
    count(*)::bigint
  into measured_bytes, measured_rows
  from public.router_migration_jobs j
  where j.id = any(ids)
    and j.admin_id = request_row.admin_id
    and j.status in ('completed', 'failed')
    and j.created_at < now() - interval '30 days';

  if to_regclass('public.router_migration_collector_tokens') is not null then
    select
      coalesce(sum(pg_column_size(to_jsonb(t))), 0)::bigint,
      count(*)::bigint
    into token_bytes, token_rows
    from public.router_migration_collector_tokens t
    where t.admin_id = request_row.admin_id
      and (
        t.migration_job_id = any(ids)
        or (t.expires_at < now() - interval '30 days' and t.used_at is not null)
      );
  end if;

  if to_regclass('public.router_migration_collector_chunks') is not null
     and to_regclass('public.router_migration_collector_tokens') is not null then
    select
      coalesce(sum(pg_column_size(to_jsonb(c))), 0)::bigint,
      count(*)::bigint
    into chunk_bytes, chunk_rows
    from public.router_migration_collector_chunks c
    join public.router_migration_collector_tokens t on t.token_hash = c.token_hash
    where t.admin_id = request_row.admin_id
      and (
        t.migration_job_id = any(ids)
        or (t.expires_at < now() - interval '30 days' and t.used_at is not null)
      );
  end if;

  if to_regclass('public.router_migration_collector_tokens') is not null then
    delete from public.router_migration_collector_tokens t
    where t.admin_id = request_row.admin_id
      and (
        t.migration_job_id = any(ids)
        or (t.expires_at < now() - interval '30 days' and t.used_at is not null)
      );
  end if;

  delete from public.router_migration_jobs j
  where j.id = any(ids)
    and j.admin_id = request_row.admin_id
    and j.status in ('completed', 'failed')
    and j.created_at < now() - interval '30 days';

  update public.platform_storage_cleanup_requests
  set status = 'completed',
      completed_at = now(),
      failure_details = null,
      candidate_bytes = measured_bytes + token_bytes + chunk_bytes,
      candidate_rows = measured_rows + token_rows + chunk_rows,
      updated_at = now()
  where id = request_row.id;

  return query select request_row.id,
    measured_rows + token_rows + chunk_rows,
    measured_bytes + token_bytes + chunk_bytes,
    'completed'::text;
end;
$$;

revoke all on function public.platform_execute_storage_cleanup(bigint) from public;
grant execute on function public.platform_execute_storage_cleanup(bigint) to service_role;