-- Migration-only source records are created under an authenticated ISP admin
-- and finalized only after a RouterOS API identity preflight succeeds.
alter table public.isp_routers
  add column if not exists identity text,
  add column if not exists serial text,
  add column if not exists migration_source_only boolean not null default false;

create unique index if not exists isp_routers_admin_normalized_name_uidx
  on public.isp_routers(admin_id, lower(name));

-- Idempotency key hashes let a browser retry source registration without
-- creating a second pending router row or temporary tunnel.
alter table public.router_migration_jobs
  add column if not exists registration_key_hash text;

create unique index if not exists router_migration_jobs_registration_key_hash_idx
  on public.router_migration_jobs(admin_id, registration_key_hash)
  where registration_key_hash is not null;

create unique index if not exists isp_routers_serial_unique_uidx
  on public.isp_routers(serial)
  where serial is not null and serial <> '';

-- Serialize source-registration name allocation per tenant and create the
-- pending row in the same transaction. The unique index also protects against
-- a concurrent regular router-onboarding insert.
create or replace function public.create_router_migration_source_stub(p_admin_id bigint)
returns table(router_id bigint, router_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subdomain text;
  v_base text;
  v_name text;
  v_constraint text;
  v_ordinal integer;
begin
  if p_admin_id is null or p_admin_id <= 0 then
    raise exception 'A valid ISP admin is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('router-name:' || p_admin_id::text, 0));

  select subdomain into v_subdomain
    from isp_admins
   where id = p_admin_id;
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
        migration_source_only, description
      ) values (
        p_admin_id, v_name, '', 'admin', null, 'setup',
        true, 'Pending identity verification through RouterOS migration. Temporary access only.'
      )
      returning id, name into router_id, router_name;

      return next;
      return;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'isp_routers_admin_normalized_name_uidx' then
        raise;
      end if;
      -- A simultaneous regular router onboarding may claim this ordinal.
      -- Continue to the next one instead of creating a duplicate name.
    end;
  end loop;

  raise exception 'No available router name remains for this ISP account';
end;
$$;

revoke all on function public.create_router_migration_source_stub(bigint) from public;
grant execute on function public.create_router_migration_source_stub(bigint) to service_role;