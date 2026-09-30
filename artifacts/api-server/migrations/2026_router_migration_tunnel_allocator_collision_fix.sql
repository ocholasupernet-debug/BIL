-- Prevent temporary migration leases from reusing a pair occupied by a
-- persistent management address or by a previously failed provisioning
-- attempt.  The allocator is deliberately serialized globally because the
-- address pool is shared by every ISP account.
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
  -- 10.8.6.0/24 is shared across tenants, so tenant-scoped locks do not
  -- protect two concurrent allocations from choosing the same pair.
  perform pg_advisory_xact_lock(hashtextextended(
    'router-migration-vpn-address-pool',
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
    where split_part(split_part(r.vpn_ip::text, '/', 1), '.', 1) = '10'
      and split_part(split_part(r.vpn_ip::text, '/', 1), '.', 2) = '8'
      and split_part(split_part(r.vpn_ip::text, '/', 1), '.', 3) = '5'
      and split_part(split_part(r.vpn_ip::text, '/', 1), '.', 4) ~ '^[0-9]+$'
      and split_part(split_part(r.vpn_ip::text, '/', 1), '.', 4)::integer / 2 = gs.host_no / 2
  )
    and not exists (
      select 1 from router_migration_tunnel_leases l
      where l.status in (
          'issued', 'script_issued', 'connected', 'exported',
          'server_unavailable'
        )
        and family(l.assigned_ip) = 4
        and split_part(host(l.assigned_ip), '.', 4)::integer / 2 = gs.host_no / 2
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