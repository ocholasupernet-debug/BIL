-- Encrypted RouterOS PPP and Hotspot user snapshots. The service role is the
-- only database principal allowed to read or modify these rows.
create table if not exists public.router_user_snapshots (
  id bigserial primary key,
  admin_id bigint not null references public.isp_admins(id) on delete cascade,
  router_id bigint not null references public.isp_routers(id) on delete cascade,
  ciphertext text,
  iv text,
  auth_tag text,
  schedule_enabled boolean not null default false,
  next_sync_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  last_synced_at timestamptz,
  last_sync_status text not null default 'never'
    check (last_sync_status in ('never', 'success', 'failed')),
  last_error_code text
    check (last_error_code is null or last_error_code in ('router_unavailable', 'sync_failed', 'snapshot_too_large')),
  ppp_count integer not null default 0 check (ppp_count >= 0),
  hotspot_count integer not null default 0 check (hotspot_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (admin_id, router_id),
  check (
    (ciphertext is null and iv is null and auth_tag is null)
    or (ciphertext is not null and iv is not null and auth_tag is not null)
  ),
  check (
    (lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)
  )
);

create index if not exists router_user_snapshots_due_idx
  on public.router_user_snapshots(next_sync_at)
  where schedule_enabled = true;

alter table public.router_user_snapshots enable row level security;
revoke all on table public.router_user_snapshots from anon, authenticated;
grant select, insert, update, delete on table public.router_user_snapshots to service_role;
grant usage, select on sequence public.router_user_snapshots_id_seq to service_role;

create or replace function public.set_router_user_snapshot_schedule(
  p_admin_id bigint,
  p_router_id bigint,
  p_enabled boolean
)
returns table(schedule_enabled boolean, next_sync_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_admin_id is null or p_router_id is null or p_enabled is null then
    raise exception 'Invalid router user snapshot schedule request';
  end if;
  if not exists (
    select 1 from public.isp_routers r
    where r.id = p_router_id and r.admin_id = p_admin_id
  ) then
    raise exception 'Router does not belong to this ISP account';
  end if;

  return query
    insert into public.router_user_snapshots as current_snapshot
      (admin_id, router_id, schedule_enabled, next_sync_at)
    values (
      p_admin_id,
      p_router_id,
      p_enabled,
      case when p_enabled then now() + interval '24 hours' else null end
    )
    on conflict (admin_id, router_id) do update
      set schedule_enabled = excluded.schedule_enabled,
          next_sync_at = excluded.next_sync_at,
          updated_at = now()
    returning current_snapshot.schedule_enabled, current_snapshot.next_sync_at;
end;
$$;

create or replace function public.claim_router_user_snapshot(
  p_admin_id bigint,
  p_router_id bigint,
  p_force boolean default false
)
returns table(lease_token uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_admin_id is null or p_router_id is null then
    raise exception 'Invalid router user snapshot claim request';
  end if;
  if not exists (
    select 1 from public.isp_routers r
    where r.id = p_router_id and r.admin_id = p_admin_id
  ) then
    raise exception 'Router does not belong to this ISP account';
  end if;

  insert into public.router_user_snapshots(admin_id, router_id)
  values (p_admin_id, p_router_id)
  on conflict (admin_id, router_id) do nothing;

  return query
    update public.router_user_snapshots s
       set lease_token = gen_random_uuid(),
           lease_expires_at = now() + interval '20 minutes',
           last_attempt_at = now(),
           updated_at = now()
     where s.admin_id = p_admin_id
       and s.router_id = p_router_id
       and (s.lease_token is null or s.lease_expires_at <= now())
       and (
         p_force
         or (s.schedule_enabled = true and s.next_sync_at <= now())
       )
    returning s.lease_token;
end;
$$;

create or replace function public.claim_due_router_user_snapshots(p_limit integer default 5)
returns table(admin_id bigint, router_id bigint, lease_token uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    with candidates as (
      select s.id
        from public.router_user_snapshots s
       where s.schedule_enabled = true
         and s.next_sync_at <= now()
         and (s.lease_token is null or s.lease_expires_at <= now())
       order by s.next_sync_at, s.id
       limit greatest(1, least(coalesce(p_limit, 5), 20))
       for update skip locked
    ),
    claimed as (
      update public.router_user_snapshots s
         set lease_token = gen_random_uuid(),
             lease_expires_at = now() + interval '20 minutes',
             last_attempt_at = now(),
             updated_at = now()
        from candidates c
       where s.id = c.id
      returning s.admin_id, s.router_id, s.lease_token
    )
    select claimed.admin_id, claimed.router_id, claimed.lease_token
      from claimed;
end;
$$;

create or replace function public.complete_router_user_snapshot(
  p_admin_id bigint,
  p_router_id bigint,
  p_lease_token uuid,
  p_ciphertext text,
  p_iv text,
  p_auth_tag text,
  p_ppp_count integer,
  p_hotspot_count integer,
  p_synced_at timestamptz
)
returns table(completed boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update public.router_user_snapshots s
       set ciphertext = p_ciphertext,
           iv = p_iv,
           auth_tag = p_auth_tag,
           ppp_count = p_ppp_count,
           hotspot_count = p_hotspot_count,
           last_synced_at = p_synced_at,
           last_sync_status = 'success',
           last_error_code = null,
           next_sync_at = case
             when s.schedule_enabled then p_synced_at + interval '24 hours'
             else null
           end,
           lease_token = null,
           lease_expires_at = null,
           updated_at = now()
     where s.admin_id = p_admin_id
       and s.router_id = p_router_id
       and s.lease_token = p_lease_token
       and p_ciphertext is not null
       and p_iv is not null
       and p_auth_tag is not null
       and p_ppp_count >= 0
       and p_hotspot_count >= 0
    returning true;
end;
$$;

create or replace function public.fail_router_user_snapshot(
  p_admin_id bigint,
  p_router_id bigint,
  p_lease_token uuid,
  p_error_code text
)
returns table(failed boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_error_code not in ('router_unavailable', 'sync_failed', 'snapshot_too_large') then
    raise exception 'Invalid router user snapshot failure code';
  end if;

  return query
    update public.router_user_snapshots s
       set last_sync_status = 'failed',
           last_error_code = p_error_code,
           next_sync_at = case
             when s.schedule_enabled then now() + interval '6 hours'
             else null
           end,
           lease_token = null,
           lease_expires_at = null,
           updated_at = now()
     where s.admin_id = p_admin_id
       and s.router_id = p_router_id
       and s.lease_token = p_lease_token
    returning true;
end;
$$;

revoke all on function public.set_router_user_snapshot_schedule(bigint, bigint, boolean) from public, anon, authenticated;
revoke all on function public.claim_router_user_snapshot(bigint, bigint, boolean) from public, anon, authenticated;
revoke all on function public.claim_due_router_user_snapshots(integer) from public, anon, authenticated;
revoke all on function public.complete_router_user_snapshot(bigint, bigint, uuid, text, text, text, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_router_user_snapshot(bigint, bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.set_router_user_snapshot_schedule(bigint, bigint, boolean) to service_role;
grant execute on function public.claim_router_user_snapshot(bigint, bigint, boolean) to service_role;
grant execute on function public.claim_due_router_user_snapshots(integer) to service_role;
grant execute on function public.complete_router_user_snapshot(bigint, bigint, uuid, text, text, text, integer, integer, timestamptz) to service_role;
grant execute on function public.fail_router_user_snapshot(bigint, bigint, uuid, text) to service_role;