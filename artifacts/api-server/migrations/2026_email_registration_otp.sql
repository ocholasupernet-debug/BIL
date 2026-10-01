create table if not exists email_registration_otp_challenges (
  id uuid primary key,
  email text not null,
  otp_hash text not null,
  request_ip_hash text not null default '',
  attempt_count integer not null default 0
    check (attempt_count between 0 and 5),
  expires_at timestamptz not null,
  action_token_hash text,
  action_expires_at timestamptz,
  verified_at timestamptz,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint email_registration_otp_email_lower
    check (email = lower(trim(email))),
  constraint email_registration_otp_hash_format
    check (otp_hash ~ '^[0-9a-f]{64}$'),
  constraint email_registration_action_hash_format
    check (action_token_hash is null or action_token_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists email_registration_otp_email_created_idx
  on email_registration_otp_challenges(email, created_at desc);
create index if not exists email_registration_otp_ip_created_idx
  on email_registration_otp_challenges(request_ip_hash, created_at desc)
  where request_ip_hash <> '';
create index if not exists email_registration_otp_action_token_idx
  on email_registration_otp_challenges(action_token_hash)
  where action_token_hash is not null and consumed_at is null;

alter table email_registration_otp_challenges enable row level security;
revoke all on table email_registration_otp_challenges
  from public, anon, authenticated;

create or replace function issue_email_registration_otp(
  p_id uuid,
  p_email text,
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
  v_email text := lower(trim(coalesce(p_email, '')));
  v_email_count integer;
  v_ip_count integer;
  v_last_request timestamptz;
  v_ip_hash text := coalesce(p_ip_hash, '');
begin
  if p_id is null
     or v_email = ''
     or length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_otp_hash is null
     or p_otp_hash !~ '^[0-9a-f]{64}$'
     or (v_ip_hash <> '' and v_ip_hash !~ '^[0-9a-f]{64}$')
     or p_expires_at is null
     or p_expires_at <= now()
     or p_expires_at > now() + interval '10 minutes' then
    return query select 'invalid'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('email-registration-otp:email:' || v_email, 0)
  );
  if v_ip_hash <> '' then
    perform pg_advisory_xact_lock(
      hashtextextended('email-registration-otp:ip:' || v_ip_hash, 0)
    );
  end if;

  delete from email_registration_otp_challenges
  where created_at < now() - interval '48 hours';

  select count(*), max(created_at)
    into v_email_count, v_last_request
  from email_registration_otp_challenges
  where email = v_email
    and created_at > now() - interval '1 hour';

  if v_email_count >= 5
     or (v_last_request is not null
         and v_last_request > now() - interval '60 seconds') then
    return query select 'limited'::text;
    return;
  end if;

  if v_ip_hash <> '' then
    select count(*) into v_ip_count
    from email_registration_otp_challenges
    where request_ip_hash = v_ip_hash
      and created_at > now() - interval '1 hour';
    if v_ip_count >= 20 then
      return query select 'limited'::text;
      return;
    end if;
  end if;

  update email_registration_otp_challenges
  set invalidated_at = now()
  where email = v_email
    and consumed_at is null
    and invalidated_at is null;

  insert into email_registration_otp_challenges(
    id, email, otp_hash, request_ip_hash, expires_at
  ) values (
    p_id, v_email, p_otp_hash, v_ip_hash, p_expires_at
  );

  return query select 'issued'::text;
end
$$;

create or replace function verify_email_registration_otp(
  p_id uuid,
  p_email text,
  p_otp_hash text,
  p_action_token_hash text
)
returns table(outcome text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge email_registration_otp_challenges%rowtype;
begin
  if p_id is null
     or p_email is null
     or p_otp_hash is null
     or p_otp_hash !~ '^[0-9a-f]{64}$'
     or p_action_token_hash is null
     or p_action_token_hash !~ '^[0-9a-f]{64}$' then
    return query select 'invalid'::text;
    return;
  end if;

  select * into v_challenge
  from email_registration_otp_challenges
  where id = p_id
    and email = lower(trim(p_email))
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
    update email_registration_otp_challenges
    set attempt_count = attempt_count + 1,
        invalidated_at = case
          when attempt_count + 1 >= 5 then now()
          else invalidated_at
        end
    where id = p_id;
    return query select 'invalid'::text;
    return;
  end if;

  update email_registration_otp_challenges
  set verified_at = now(),
      action_token_hash = p_action_token_hash,
      action_expires_at = now() + interval '10 minutes'
  where id = p_id;

  return query select 'verified'::text;
end
$$;

create or replace function consume_email_registration_token(
  p_email text,
  p_action_token_hash text
)
returns table(consumed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  if p_email is null
     or p_action_token_hash is null
     or p_action_token_hash !~ '^[0-9a-f]{64}$' then
    return query select false;
    return;
  end if;

  update email_registration_otp_challenges
  set consumed_at = now()
  where email = lower(trim(p_email))
    and action_token_hash = p_action_token_hash
    and verified_at is not null
    and action_expires_at > now()
    and consumed_at is null
    and invalidated_at is null;
  get diagnostics v_rows = row_count;

  return query select v_rows = 1;
end
$$;

create or replace function invalidate_email_registration_otp(
  p_id uuid,
  p_email text
)
returns table(invalidated boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  update email_registration_otp_challenges
  set invalidated_at = now()
  where id = p_id
    and email = lower(trim(coalesce(p_email, '')))
    and verified_at is null
    and consumed_at is null
    and invalidated_at is null;
  get diagnostics v_rows = row_count;

  return query select v_rows = 1;
end
$$;

revoke all on function issue_email_registration_otp(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function verify_email_registration_otp(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function consume_email_registration_token(text, text)
  from public, anon, authenticated;
revoke all on function invalidate_email_registration_otp(uuid, text)
  from public, anon, authenticated;
grant execute on function issue_email_registration_otp(uuid, text, text, text, timestamptz)
  to service_role;
grant execute on function verify_email_registration_otp(uuid, text, text, text)
  to service_role;
grant execute on function consume_email_registration_token(text, text)
  to service_role;
grant execute on function invalidate_email_registration_otp(uuid, text)
  to service_role;