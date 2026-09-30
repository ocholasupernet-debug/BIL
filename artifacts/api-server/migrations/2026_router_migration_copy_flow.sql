-- Explicit target semantics let an operator adopt the inspected source without
-- pretending it was copied to a second device. Adoption uses target_router_id
-- NULL and never writes RouterOS or billing data.
alter table router_migration_jobs
  add column if not exists target_mode text not null default 'replace_router';
alter table router_migration_jobs
  drop constraint if exists router_migration_jobs_target_mode_check;
alter table router_migration_jobs
  add constraint router_migration_jobs_target_mode_check
  check (target_mode in ('adopt_source', 'replace_router'));
alter table router_migration_jobs
  add column if not exists pre_state_ciphertext text,
  add column if not exists pre_state_iv text,
  add column if not exists pre_state_auth_tag text;
alter table router_migration_jobs
  drop constraint if exists router_migration_jobs_status_check;
alter table router_migration_jobs
  add constraint router_migration_jobs_status_check
  check (status in (
    'source_pending', 'tunnel_issued', 'connected', 'exported',
    'target_selected', 'dry_run', 'importing', 'completed', 'failed'
  ));

-- Temporary clients reserve a whole adjacent-address pair. Persistent backup
-- addresses are derived from the 10.8.5.x primary pool and are excluded by the
-- allocator below.
alter table router_migration_tunnel_leases
  drop constraint if exists router_migration_tunnel_leases_assigned_ip_key;
create unique index if not exists router_migration_tunnel_active_pair_idx
  on router_migration_tunnel_leases (
    (split_part(host(assigned_ip), '.', 4)::integer / 2)
  )
  where status in ('issued', 'script_issued', 'connected', 'exported');

create or replace function issue_router_migration_tunnel_lease(
  p_admin_id bigint,
  p_source_router_id bigint,
  p_migration_job_id bigint,
  p_username text,
  p_server_endpoint text,
  p_bootstrap_token_hash text,
  p_ciphertext text,
  p_iv text,
  p_auth_tag text,
  p_expires_at timestamptz
) returns table(lease_id bigint, assigned_ip inet)
language plpgsql security definer set search_path = public
as $$
declare
  candidate_host integer;
  candidate_ip inet;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    p_admin_id::text || ':' || p_source_router_id::text,
    0
  ));

  if not exists (
    select 1 from isp_routers
    where id = p_source_router_id and admin_id = p_admin_id
  ) then
    raise exception 'Migration source router is not owned by this ISP account';
  end if;

  if exists (
    select 1 from router_migration_tunnel_leases
    where admin_id = p_admin_id
      and source_router_id = p_source_router_id
      and status in ('issued', 'script_issued', 'connected', 'exported')
  ) then
    raise exception 'An unexpired migration tunnel already exists for this source router';
  end if;

  select gs.host_no into candidate_host
  from generate_series(2, 252, 2) as gs(host_no)
  where not exists (
    select 1 from isp_routers r
    where split_part(split_part(r.vpn_ip::text, '/', 1), '.', 3) = '5'
      and split_part(split_part(r.vpn_ip::text, '/', 1), '.', 4) ~ '^[0-9]+$'
      and (
        split_part(split_part(r.vpn_ip::text, '/', 1), '.', 4)::integer / 2
      ) = (host_no / 2)
  )
    and not exists (
      select 1 from router_migration_tunnel_leases l
      where l.status in ('issued', 'script_issued', 'connected', 'exported')
        and (
          split_part(host(l.assigned_ip), '.', 4)::integer / 2
        ) = (host_no / 2)
    )
  order by gs.host_no
  limit 1;

  if candidate_host is null then
    raise exception 'The isolated migration VPN address pool is exhausted';
  end if;

  candidate_ip := ('10.8.6.' || candidate_host::text)::inet;
  return query
  insert into router_migration_tunnel_leases(
    admin_id, source_router_id, migration_job_id, technology, username,
    assigned_ip, server_endpoint, bootstrap_token_hash,
    ciphertext, iv, auth_tag, status, expires_at
  )
  values (
    p_admin_id, p_source_router_id, p_migration_job_id, 'openvpn', p_username,
    candidate_ip, p_server_endpoint, p_bootstrap_token_hash,
    p_ciphertext, p_iv, p_auth_tag, 'issued', p_expires_at
  )
  returning id, router_migration_tunnel_leases.assigned_ip;
end;
$$;

revoke all on function issue_router_migration_tunnel_lease(
  bigint, bigint, bigint, text, text, text, text, text, text, timestamptz
) from public;
grant execute on function issue_router_migration_tunnel_lease(
  bigint, bigint, bigint, text, text, text, text, text, text, timestamptz
) to service_role;

create or replace function store_router_migration_collector_chunk(
  p_token_hash text,
  p_chunk_index integer,
  p_ciphertext text,
  p_iv text,
  p_auth_tag text
) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from router_migration_collector_tokens
    where token_hash = p_token_hash and used_at is null and expires_at > now()
  ) then
    return false;
  end if;
  insert into router_migration_collector_chunks(token_hash, chunk_index, ciphertext, iv, auth_tag)
  values (p_token_hash, p_chunk_index, p_ciphertext, p_iv, p_auth_tag)
  on conflict (token_hash, chunk_index) do nothing;
  return true;
end;
$$;
revoke all on function store_router_migration_collector_chunk(text, integer, text, text, text) from public;
grant execute on function store_router_migration_collector_chunk(text, integer, text, text, text) to service_role;