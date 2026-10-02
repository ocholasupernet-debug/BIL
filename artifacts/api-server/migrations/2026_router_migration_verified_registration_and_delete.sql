-- A registration job and temporary tunnel may exist before the source router
-- has been verified. The durable isp_routers row is created only after the
-- API has completed the authenticated RouterOS identity preflight.
alter table public.router_migration_tunnel_leases
  alter column source_router_id drop not null;

-- The previous flow persisted a temporary router stub before verification.
-- Preserve its registration job/tunnel, but remove the unverified router row
-- so that it can be created later by the verified finalization RPC.
do $$
declare
  v_pending_router_ids bigint[];
begin
  select coalesce(array_agg(r.id), '{}'::bigint[])
    into v_pending_router_ids
    from isp_routers r
   where r.migration_source_only = true
     and (
       nullif(btrim(coalesce(r.identity, '')), '') is null
       or nullif(btrim(coalesce(r.ros_version, '')), '') is null
     );

  if cardinality(v_pending_router_ids) > 0 then
    update router_migration_jobs j
       set source_label = coalesce(nullif(btrim(r.name), ''), j.source_label, 'Unverified migration source'),
           source_router_id = null,
           updated_at = now()
      from isp_routers r
     where r.id = any(v_pending_router_ids)
       and j.source_router_id = r.id;

    update router_migration_tunnel_leases l
       set source_router_id = null
     where l.source_router_id = any(v_pending_router_ids);

    delete from isp_routers r where r.id = any(v_pending_router_ids);
  end if;
end;
$$;

drop function if exists public.create_router_migration_source_stub(bigint);

create or replace function public.issue_router_migration_tunnel_lease(
  p_admin_id bigint,
  p_source_router_id bigint,
  p_migration_job_id bigint,
  p_username text,
  p_server_endpoint text,
  p_bootstrap_token_hash text,
  p_ciphertext text,
  p_iv text,
  p_auth_tag text,
  p_expires_at timestamptz,
  p_backup_ccd_pairs integer[]
) returns table(lease_id bigint, assigned_ip inet)
language plpgsql security definer set search_path = public
as $$
declare
  candidate_host integer;
  candidate_ip inet;
  v_job_source_id bigint;
  v_registration_key_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended('router-migration-vpn-address-pool', 0));

  if p_admin_id is null or p_admin_id <= 0
     or p_migration_job_id is null or p_migration_job_id <= 0 then
    raise exception 'A valid ISP admin and migration job are required';
  end if;
  if p_backup_ccd_pairs is null then
    raise exception 'Live backup CCD reservation scan is required';
  end if;
  if exists (
    select 1
    from unnest(p_backup_ccd_pairs) as reserved(pair_no)
    where pair_no is null or pair_no < 1 or pair_no > 126
  ) then
    raise exception 'Invalid live backup CCD reservation';
  end if;

  select j.source_router_id, j.registration_key_hash
    into v_job_source_id, v_registration_key_hash
    from router_migration_jobs j
   where j.id = p_migration_job_id
     and j.admin_id = p_admin_id
   for update;
  if not found then
    raise exception 'Migration job is not owned by this ISP account';
  end if;

  if p_source_router_id is not null then
    if v_job_source_id is distinct from p_source_router_id
       or not exists (
         select 1 from isp_routers r
          where r.id = p_source_router_id and r.admin_id = p_admin_id
       ) then
      raise exception 'Migration source router is not owned by this ISP account';
    end if;
  elsif v_job_source_id is not null or v_registration_key_hash is null then
    raise exception 'An unverified source requires a one-time source registration job';
  end if;

  if exists (
    select 1
      from router_migration_tunnel_leases l
     where l.admin_id = p_admin_id
       and l.status in ('issued', 'script_issued', 'connected', 'exported', 'server_unavailable')
       and (
         l.migration_job_id = p_migration_job_id
         or (p_source_router_id is not null and l.source_router_id = p_source_router_id)
       )
  ) then
    raise exception 'An unexpired migration tunnel already exists for this source or job';
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
     and gs.host_no / 2 <> all(coalesce(p_backup_ccd_pairs, '{}'::integer[]))
     and not exists (
       select 1 from router_migration_tunnel_leases l
        where l.status in ('issued', 'script_issued', 'connected', 'exported', 'server_unavailable')
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

revoke all on function public.issue_router_migration_tunnel_lease(
  bigint, bigint, bigint, text, text, text, text, text, text, timestamptz, integer[]
) from public, anon, authenticated;
grant execute on function public.issue_router_migration_tunnel_lease(
  bigint, bigint, bigint, text, text, text, text, text, text, timestamptz, integer[]
) to service_role;

create or replace function public.finalize_router_migration_source_registration(
  p_admin_id bigint,
  p_job_id bigint,
  p_tunnel_id bigint,
  p_identity text,
  p_serial text,
  p_model text,
  p_ros_version text
) returns table(router_id bigint, router_name text)
language plpgsql security definer set search_path = public
as $$
declare
  v_job router_migration_jobs%rowtype;
  v_subdomain text;
  v_base text;
  v_name text;
  v_constraint text;
  v_ordinal integer;
  v_router_id bigint;
  v_router_name text;
begin
  if p_admin_id is null or p_admin_id <= 0
     or p_job_id is null or p_job_id <= 0
     or p_tunnel_id is null or p_tunnel_id <= 0 then
    raise exception 'A valid ISP admin, migration job, and verified tunnel are required';
  end if;
  if nullif(btrim(coalesce(p_identity, '')), '') is null
     or nullif(btrim(coalesce(p_ros_version, '')), '') is null then
    raise exception 'RouterOS identity and version verification are required';
  end if;

  select j.* into v_job
    from router_migration_jobs j
   where j.id = p_job_id and j.admin_id = p_admin_id
   for update;
  if not found or v_job.registration_key_hash is null then
    raise exception 'A one-time source registration job is required';
  end if;

  if not exists (
    select 1 from router_migration_tunnel_leases l
     where l.id = p_tunnel_id
       and l.admin_id = p_admin_id
       and l.migration_job_id = p_job_id
       and l.status in ('script_issued', 'connected')
       and l.expires_at > now()
     for update
  ) then
    raise exception 'The verified migration tunnel is unavailable or expired';
  end if;

  if v_job.source_router_id is not null then
    select r.id, r.name into v_router_id, v_router_name
      from isp_routers r
     where r.id = v_job.source_router_id
       and r.admin_id = p_admin_id
       and r.migration_source_only = true
       and r.identity = btrim(p_identity)
       and coalesce(r.serial, '') = coalesce(nullif(btrim(p_serial), ''), '')
       and coalesce(r.model, '') = coalesce(nullif(btrim(p_model), ''), '')
       and coalesce(r.ros_version, '') = btrim(p_ros_version);
    if not found then
      raise exception 'The finalized migration source record is unavailable';
    end if;
    update router_migration_tunnel_leases
       set source_router_id = v_router_id
     where id = p_tunnel_id;
    return query select v_router_id, v_router_name;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('router-name:' || p_admin_id::text, 0));
  select a.subdomain into v_subdomain from isp_admins a where a.id = p_admin_id;
  if not found then
    raise exception 'ISP admin not found';
  end if;

  v_base := lower(btrim(coalesce(v_subdomain, '')));
  v_base := regexp_replace(v_base, '[^a-z0-9-]+', '-', 'g');
  v_base := regexp_replace(v_base, '^-+|-+$', '', 'g');
  v_base := left(v_base, 27);
  v_base := regexp_replace(v_base, '-+$', '', 'g');
  if v_base = '' then
    raise exception 'ISP admin has no valid subdomain for router naming';
  end if;

  for v_ordinal in 1..9999 loop
    v_name := v_base || v_ordinal::text;
    begin
      insert into isp_routers (
        admin_id, name, host, router_username, router_secret, status,
        identity, serial, model, ros_version, migration_source_only, description
      ) values (
        p_admin_id, v_name, '', 'admin', null, 'offline',
        btrim(p_identity), nullif(btrim(coalesce(p_serial, '')), ''),
        nullif(btrim(coalesce(p_model, '')), ''), btrim(p_ros_version), true,
        'Migration source only. RouterOS access is temporary; no persistent management credentials are configured.'
      )
      returning id, name into v_router_id, v_router_name;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'isp_routers_serial_unique_uidx' then
        raise exception 'Router serial is already registered';
      elsif v_constraint <> 'isp_routers_admin_normalized_name_uidx' then
        raise;
      end if;
    end;
  end loop;

  if v_router_id is null then
    raise exception 'No available router name remains for this ISP account';
  end if;

  update router_migration_jobs
     set source_router_id = v_router_id,
         source_label = v_router_name,
         updated_at = now()
   where id = p_job_id and admin_id = p_admin_id;
  update router_migration_tunnel_leases
     set source_router_id = v_router_id
   where id = p_tunnel_id and admin_id = p_admin_id;

  return query select v_router_id, v_router_name;
end;
$$;

revoke all on function public.finalize_router_migration_source_registration(
  bigint, bigint, bigint, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.finalize_router_migration_source_registration(
  bigint, bigint, bigint, text, text, text, text
) to service_role;

-- Return the exact active temporary VPN usernames the API must revoke before
-- the database cleanup transaction can delete their lease history.
create or replace function public.prepare_super_admin_router_deletion(p_router_id bigint)
returns table(
  router_id bigint,
  admin_id bigint,
  router_name text,
  active_vpn_usernames text[]
)
language plpgsql security definer set search_path = public
as $$
declare
  v_router_id bigint;
  v_admin_id bigint;
  v_router_name text;
  v_job_ids bigint[];
  v_usernames text[];
begin
  if p_router_id is null or p_router_id <= 0 then
    raise exception 'A valid router id is required';
  end if;

  select r.id, r.admin_id, r.name
    into v_router_id, v_admin_id, v_router_name
    from isp_routers r
   where r.id = p_router_id
   for update;
  if not found then
    return;
  end if;

  if exists (
    select 1 from router_migration_jobs j
     where (j.source_router_id = p_router_id or j.target_router_id = p_router_id)
       and j.admin_id <> v_admin_id
  ) then
    raise exception 'Router migration history is assigned to a different ISP account';
  end if;

  select array_agg(j.id) into v_job_ids
    from router_migration_jobs j
   where j.source_router_id = p_router_id or j.target_router_id = p_router_id;

  select coalesce(array_agg(distinct l.username order by l.username), '{}'::text[])
    into v_usernames
    from router_migration_tunnel_leases l
   where (l.source_router_id = p_router_id or l.migration_job_id = any(coalesce(v_job_ids, '{}'::bigint[])))
     and l.status in ('issued', 'script_issued', 'connected', 'exported', 'server_unavailable');

  return query select v_router_id, v_admin_id, v_router_name, v_usernames;
end;
$$;

revoke all on function public.prepare_super_admin_router_deletion(bigint)
  from public, anon, authenticated;
grant execute on function public.prepare_super_admin_router_deletion(bigint)
  to service_role;

-- Erase the router's linked customer/router rows and all migration records in
-- one transaction. Any unhandled restrictive FK aborts the whole operation.
create or replace function public.delete_super_admin_router_with_history(
  p_router_id bigint,
  p_revoked_vpn_usernames text[]
) returns table(
  router_id bigint,
  admin_id bigint,
  router_name text,
  migration_jobs_deleted integer
)
language plpgsql security definer set search_path = public
as $$
declare
  v_router_id bigint;
  v_admin_id bigint;
  v_router_name text;
  v_job_ids bigint[];
  v_deleted_jobs integer := 0;
  v_table text;
begin
  if p_router_id is null or p_router_id <= 0 then
    raise exception 'A valid router id is required';
  end if;

  select r.id, r.admin_id, r.name
    into v_router_id, v_admin_id, v_router_name
    from isp_routers r
   where r.id = p_router_id
   for update;
  if not found then
    return;
  end if;

  if exists (
    select 1 from router_migration_jobs j
     where (j.source_router_id = p_router_id or j.target_router_id = p_router_id)
       and j.admin_id <> v_admin_id
  ) then
    raise exception 'Router migration history is assigned to a different ISP account';
  end if;

  select array_agg(j.id) into v_job_ids
    from router_migration_jobs j
   where j.source_router_id = p_router_id or j.target_router_id = p_router_id;

  if exists (
    select 1 from router_migration_tunnel_leases l
     where (l.source_router_id = p_router_id or l.migration_job_id = any(coalesce(v_job_ids, '{}'::bigint[])))
       and l.status in ('issued', 'script_issued', 'connected', 'exported', 'server_unavailable')
       and not (l.username = any(coalesce(p_revoked_vpn_usernames, '{}'::text[])))
  ) then
    raise exception 'Active temporary migration VPN clients must be revoked before router deletion';
  end if;

  if coalesce(cardinality(v_job_ids), 0) > 0 then
    delete from router_migration_collector_tokens t
     where t.migration_job_id = any(v_job_ids);
    delete from router_migration_tunnel_leases l
     where l.source_router_id = p_router_id or l.migration_job_id = any(v_job_ids);
    delete from router_migration_target_leases l
     where l.target_router_id = p_router_id or l.migration_job_id = any(v_job_ids);
    delete from router_migration_jobs j
     where j.id = any(v_job_ids);
    get diagnostics v_deleted_jobs = row_count;
  else
    delete from router_migration_tunnel_leases l
     where l.source_router_id = p_router_id;
    delete from router_migration_target_leases l
     where l.target_router_id = p_router_id;
  end if;

  foreach v_table in array array[
    'isp_ip_pools',
    'isp_ppp_secrets',
    'isp_pppoe_users',
    'isp_hotspot_users',
    'isp_bridge_ports',
    'isp_router_history',
    'isp_router_sessions',
    'isp_active_sessions',
    'isp_router_pings',
    'isp_router_metrics',
    'router_user_snapshots'
  ] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('delete from public.%I where router_id = $1', v_table)
        using p_router_id;
    end if;
  end loop;

  delete from isp_customers c where c.router_id = p_router_id;
  delete from isp_routers r where r.id = p_router_id;
  if not found then
    raise exception 'Router deletion did not remove the requested record';
  end if;

  return query select v_router_id, v_admin_id, v_router_name, v_deleted_jobs;
end;
$$;

revoke all on function public.delete_super_admin_router_with_history(bigint, text[])
  from public, anon, authenticated;
grant execute on function public.delete_super_admin_router_with_history(bigint, text[])
  to service_role;

notify pgrst, 'reload schema';