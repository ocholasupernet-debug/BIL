create table if not exists hotspot_customer_password_reset_lookup_limits (
  request_ip_hash text primary key check (request_ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count between 0 and 11),
  updated_at timestamptz not null default now()
);

alter table hotspot_customer_password_reset_lookup_limits enable row level security;
revoke all on table hotspot_customer_password_reset_lookup_limits
  from public, anon, authenticated;
create index if not exists hotspot_customer_password_reset_lookup_updated_idx
  on hotspot_customer_password_reset_lookup_limits(updated_at);

create table if not exists hotspot_customer_password_reset_challenges (
  id uuid primary key,
  tenant_admin_id bigint not null,
  customer_admin_id bigint not null,
  customer_id bigint not null,
  channel text not null check (channel in ('email', 'phone')),
  destination_hash text not null check (destination_hash ~ '^[0-9a-f]{64}$'),
  otp_hash text not null check (otp_hash ~ '^[0-9a-f]{64}$'),
  request_ip_hash text not null default '',
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  expires_at timestamptz not null,
  action_token_hash text,
  action_expires_at timestamptz,
  verified_at timestamptz,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint hotspot_customer_password_reset_ip_hash_format
    check (request_ip_hash = '' or request_ip_hash ~ '^[0-9a-f]{64}$'),
  constraint hotspot_customer_password_reset_action_hash_format
    check (action_token_hash is null or action_token_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists hotspot_customer_password_reset_account_created_idx
  on hotspot_customer_password_reset_challenges(
    tenant_admin_id, customer_admin_id, customer_id, created_at desc
  );
create index if not exists hotspot_customer_password_reset_ip_created_idx
  on hotspot_customer_password_reset_challenges(request_ip_hash, created_at desc)
  where request_ip_hash <> '';
create index if not exists hotspot_customer_password_reset_created_idx
  on hotspot_customer_password_reset_challenges(created_at);
create index if not exists hotspot_customer_password_reset_action_idx
  on hotspot_customer_password_reset_challenges(tenant_admin_id, action_token_hash)
  where action_token_hash is not null and consumed_at is null;

alter table hotspot_customer_password_reset_challenges enable row level security;
revoke all on table hotspot_customer_password_reset_challenges
  from public, anon, authenticated;

create or replace function issue_hotspot_customer_password_reset(
  p_id uuid,
  p_tenant_admin_id bigint,
  p_customer_admin_id bigint,
  p_customer_id bigint,
  p_channel text,
  p_destination_hash text,
  p_otp_hash text,
  p_ip_hash text,
  p_expires_at timestamptz
)
returns table(outcome text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_count integer;
  v_ip_count integer;
  v_last_request timestamptz;
  v_ip_hash text := coalesce(p_ip_hash, '');
begin
  if p_id is null
     or p_tenant_admin_id is null or p_tenant_admin_id < 1
     or p_customer_admin_id is null or p_customer_admin_id < 1
     or p_customer_id is null or p_customer_id < 1
     or p_channel is null or p_channel not in ('email', 'phone')
     or p_destination_hash is null or p_destination_hash !~ '^[0-9a-f]{64}$'
     or p_otp_hash is null or p_otp_hash !~ '^[0-9a-f]{64}$'
     or (v_ip_hash <> '' and v_ip_hash !~ '^[0-9a-f]{64}$')
     or p_expires_at is null
     or p_expires_at <= now()
     or p_expires_at > now() + interval '10 minutes' then
    return query select 'invalid'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'hotspot-password-reset:account:' || p_tenant_admin_id::text || ':' ||
    p_customer_admin_id::text || ':' || p_customer_id::text,
    0
  ));
  if v_ip_hash <> '' then
    perform pg_advisory_xact_lock(hashtextextended(
      'hotspot-password-reset:ip:' || v_ip_hash,
      0
    ));
  end if;

  delete from hotspot_customer_password_reset_challenges
  where created_at < now() - interval '48 hours';

  select count(*), max(created_at)
    into v_account_count, v_last_request
  from hotspot_customer_password_reset_challenges
  where tenant_admin_id = p_tenant_admin_id
    and customer_admin_id = p_customer_admin_id
    and customer_id = p_customer_id
    and created_at > now() - interval '1 hour';

  if v_account_count >= 5
     or (v_last_request is not null
         and v_last_request > now() - interval '60 seconds') then
    return query select 'limited'::text;
    return;
  end if;

  if v_ip_hash <> '' then
    select count(*) into v_ip_count
    from hotspot_customer_password_reset_challenges
    where request_ip_hash = v_ip_hash
      and created_at > now() - interval '1 hour';
    if v_ip_count >= 20 then
      return query select 'limited'::text;
      return;
    end if;
  end if;

  update hotspot_customer_password_reset_challenges
  set invalidated_at = now()
  where tenant_admin_id = p_tenant_admin_id
    and customer_admin_id = p_customer_admin_id
    and customer_id = p_customer_id
    and consumed_at is null
    and invalidated_at is null;

  insert into hotspot_customer_password_reset_challenges(
    id, tenant_admin_id, customer_admin_id, customer_id, channel,
    destination_hash, otp_hash, request_ip_hash, expires_at
  ) values (
    p_id, p_tenant_admin_id, p_customer_admin_id, p_customer_id, p_channel,
    p_destination_hash, p_otp_hash, v_ip_hash, p_expires_at
  );

  return query select 'issued'::text;
end
$$;

create or replace function allow_hotspot_customer_password_reset_lookup(
  p_ip_hash text
)
returns table(allowed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt_count integer;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return query select false;
    return;
  end if;

  insert into hotspot_customer_password_reset_lookup_limits(
    request_ip_hash, window_started_at, attempt_count, updated_at
  ) values (p_ip_hash, now(), 1, now())
  on conflict (request_ip_hash) do update
    set window_started_at = case
          when hotspot_customer_password_reset_lookup_limits.window_started_at <= now() - interval '15 minutes'
            then now()
          else hotspot_customer_password_reset_lookup_limits.window_started_at
        end,
        attempt_count = case
          when hotspot_customer_password_reset_lookup_limits.window_started_at <= now() - interval '15 minutes'
            then 1
          else least(hotspot_customer_password_reset_lookup_limits.attempt_count + 1, 11)
        end,
        updated_at = now()
  returning attempt_count into v_attempt_count;

  delete from hotspot_customer_password_reset_lookup_limits
  where updated_at < now() - interval '48 hours';

  return query select v_attempt_count <= 10;
end
$$;

create or replace function verify_hotspot_customer_password_reset(
  p_id uuid,
  p_otp_hash text,
  p_action_token_hash text
)
returns table(outcome text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge hotspot_customer_password_reset_challenges%rowtype;
begin
  if p_id is null
     or p_otp_hash is null or p_otp_hash !~ '^[0-9a-f]{64}$'
     or p_action_token_hash is null or p_action_token_hash !~ '^[0-9a-f]{64}$' then
    return query select 'invalid'::text;
    return;
  end if;

  select * into v_challenge
  from hotspot_customer_password_reset_challenges
  where id = p_id
  for update;

  if not found
     or v_challenge.invalidated_at is not null
     or v_challenge.consumed_at is not null
     or v_challenge.verified_at is not null
     or v_challenge.expires_at <= now()
     or v_challenge.attempt_count >= 5 then
    return query select 'invalid'::text;
    return;
  end if;

  if v_challenge.otp_hash <> p_otp_hash then
    update hotspot_customer_password_reset_challenges
    set attempt_count = attempt_count + 1,
        invalidated_at = case
          when attempt_count + 1 >= 5 then now()
          else invalidated_at
        end
    where id = p_id;
    return query select 'invalid'::text;
    return;
  end if;

  update hotspot_customer_password_reset_challenges
  set verified_at = now(),
      action_token_hash = p_action_token_hash,
      action_expires_at = now() + interval '10 minutes'
  where id = p_id;

  return query select 'verified'::text;
end
$$;

create or replace function consume_hotspot_customer_password_reset(
  p_tenant_admin_id bigint,
  p_action_token_hash text
)
returns table(consumed boolean, customer_admin_id bigint, customer_id bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge hotspot_customer_password_reset_challenges%rowtype;
begin
  if p_tenant_admin_id is null
     or p_tenant_admin_id < 1
     or p_action_token_hash is null
     or p_action_token_hash !~ '^[0-9a-f]{64}$' then
    return query select false, null::bigint, null::bigint;
    return;
  end if;

  select * into v_challenge
  from hotspot_customer_password_reset_challenges
  where tenant_admin_id = p_tenant_admin_id
    and action_token_hash = p_action_token_hash
    and verified_at is not null
    and action_expires_at > now()
    and consumed_at is null
    and invalidated_at is null
  for update;

  if not found then
    return query select false, null::bigint, null::bigint;
    return;
  end if;

  update hotspot_customer_password_reset_challenges
  set consumed_at = now()
  where id = v_challenge.id;

  return query select true, v_challenge.customer_admin_id, v_challenge.customer_id;
end
$$;

create or replace function invalidate_hotspot_customer_password_reset(
  p_id uuid,
  p_tenant_admin_id bigint
)
returns table(invalidated boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  update hotspot_customer_password_reset_challenges
  set invalidated_at = now()
  where id = p_id
    and tenant_admin_id = p_tenant_admin_id
    and consumed_at is null
    and invalidated_at is null;
  get diagnostics v_rows = row_count;

  return query select v_rows = 1;
end
$$;

revoke all on function issue_hotspot_customer_password_reset(
  uuid, bigint, bigint, bigint, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function allow_hotspot_customer_password_reset_lookup(text)
  from public, anon, authenticated;
revoke all on function verify_hotspot_customer_password_reset(uuid, text, text)
  from public, anon, authenticated;
revoke all on function consume_hotspot_customer_password_reset(bigint, text)
  from public, anon, authenticated;
revoke all on function invalidate_hotspot_customer_password_reset(uuid, bigint)
  from public, anon, authenticated;

grant execute on function issue_hotspot_customer_password_reset(
  uuid, bigint, bigint, bigint, text, text, text, text, timestamptz
) to service_role;
grant execute on function allow_hotspot_customer_password_reset_lookup(text)
  to service_role;
grant execute on function verify_hotspot_customer_password_reset(uuid, text, text)
  to service_role;
grant execute on function consume_hotspot_customer_password_reset(bigint, text)
  to service_role;
grant execute on function invalidate_hotspot_customer_password_reset(uuid, bigint)
  to service_role;
