-- Renewable cross-worker leases serialize edits to one ISP customer's record.
-- Expired leases can be reclaimed after a worker exits unexpectedly.
create table if not exists isp_customer_edit_locks (
  admin_id bigint not null references isp_admins(id) on delete cascade,
  customer_id bigint not null references isp_customers(id) on delete cascade,
  lease_token text not null,
  expires_at timestamptz not null,
  primary key (admin_id, customer_id)
);

alter table isp_customer_edit_locks enable row level security;
revoke all on table isp_customer_edit_locks from anon, authenticated;
grant select, insert, update, delete on table isp_customer_edit_locks to service_role;

create or replace function acquire_isp_customer_edit_lock(
  p_admin_id bigint,
  p_customer_id bigint,
  p_lease_token text,
  p_lease_seconds integer
)
returns table(acquired boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acquired boolean := false;
begin
  insert into isp_customer_edit_locks(admin_id, customer_id, lease_token, expires_at)
  values (
    p_admin_id,
    p_customer_id,
    p_lease_token,
    clock_timestamp() + make_interval(secs => greatest(10, least(p_lease_seconds, 300)))
  )
  on conflict (admin_id, customer_id) do update
    set lease_token = excluded.lease_token,
        expires_at = excluded.expires_at
    where isp_customer_edit_locks.expires_at <= clock_timestamp()
  returning true into v_acquired;

  return query select coalesce(v_acquired, false);
end;
$$;

create or replace function renew_isp_customer_edit_lock(
  p_admin_id bigint,
  p_customer_id bigint,
  p_lease_token text,
  p_lease_seconds integer
)
returns table(renewed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_renewed boolean := false;
begin
  update isp_customer_edit_locks
  set expires_at = clock_timestamp() + make_interval(secs => greatest(10, least(p_lease_seconds, 300)))
  where admin_id = p_admin_id
    and customer_id = p_customer_id
    and lease_token = p_lease_token
    and expires_at > clock_timestamp()
  returning true into v_renewed;

  return query select coalesce(v_renewed, false);
end;
$$;

create or replace function release_isp_customer_edit_lock(
  p_admin_id bigint,
  p_customer_id bigint,
  p_lease_token text
)
returns table(released boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released boolean := false;
begin
  delete from isp_customer_edit_locks
  where admin_id = p_admin_id
    and customer_id = p_customer_id
    and lease_token = p_lease_token
  returning true into v_released;

  return query select coalesce(v_released, false);
end;
$$;

revoke all on function acquire_isp_customer_edit_lock(bigint, bigint, text, integer) from public, anon, authenticated;
revoke all on function renew_isp_customer_edit_lock(bigint, bigint, text, integer) from public, anon, authenticated;
revoke all on function release_isp_customer_edit_lock(bigint, bigint, text) from public, anon, authenticated;
grant execute on function acquire_isp_customer_edit_lock(bigint, bigint, text, integer) to service_role;
grant execute on function renew_isp_customer_edit_lock(bigint, bigint, text, integer) to service_role;
grant execute on function release_isp_customer_edit_lock(bigint, bigint, text) to service_role;