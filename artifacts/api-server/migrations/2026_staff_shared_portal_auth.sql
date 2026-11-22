-- Shared Staff portal authentication. Additive only; keep existing employee
-- payroll records and the employee1088 Super Admin hostname unchanged.

alter table public.employee_profiles
  add column if not exists email_verified_at timestamptz;

do $$
begin
  if exists (
    select 1
    from public.employee_profiles
    where nullif(trim(email), '') is not null
    group by lower(trim(email))
    having count(*) > 1
  ) then
    raise exception 'Staff portal migration blocked: duplicate employee email addresses must be reviewed before enforcing verified email login.';
  end if;
end
$$;

create unique index if not exists employee_profiles_email_ci_uniq
  on public.employee_profiles(lower(trim(email)))
  where nullif(trim(email), '') is not null;

create table if not exists public.employee_signup_otp_challenges (
  id uuid primary key,
  email text not null,
  otp_hash text not null check (otp_hash ~ '^[0-9a-f]{64}$'),
  request_ip_hash text not null default ''
    check (request_ip_hash = '' or request_ip_hash ~ '^[0-9a-f]{64}$'),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  expires_at timestamptz not null,
  action_token_hash text
    check (action_token_hash is null or action_token_hash ~ '^[0-9a-f]{64}$'),
  action_expires_at timestamptz,
  verified_at timestamptz,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  check (email = lower(trim(email)))
);
create index if not exists employee_signup_otp_email_created_idx
  on public.employee_signup_otp_challenges(email, created_at desc);
create index if not exists employee_signup_otp_ip_created_idx
  on public.employee_signup_otp_challenges(request_ip_hash, created_at desc)
  where request_ip_hash <> '';
create index if not exists employee_signup_otp_action_idx
  on public.employee_signup_otp_challenges(action_token_hash)
  where action_token_hash is not null and consumed_at is null;

create table if not exists public.employee_signup_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  email text not null,
  password_hash text,
  email_verified_at timestamptz not null,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'rejected')),
  employee_id uuid references public.employee_profiles(id) on delete restrict,
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  check (email = lower(trim(email))),
  check (length(trim(full_name)) between 2 and 120),
  check (phone ~ '^254[17][0-9]{8}$'),
  check (password_hash is null or password_hash ~ '^scrypt\$[A-Za-z0-9_-]{16,32}\$[A-Za-z0-9_-]{80,100}$')
);
create unique index if not exists employee_signup_requests_pending_email_uniq
  on public.employee_signup_requests(email)
  where status = 'pending_approval';
create index if not exists employee_signup_requests_review_queue_idx
  on public.employee_signup_requests(created_at)
  where status = 'pending_approval';

create table if not exists public.employee_login_otp_challenges (
  id uuid primary key,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  email text not null,
  otp_hash text not null check (otp_hash ~ '^[0-9a-f]{64}$'),
  request_ip_hash text not null default ''
    check (request_ip_hash = '' or request_ip_hash ~ '^[0-9a-f]{64}$'),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  check (email = lower(trim(email)))
);
create index if not exists employee_login_otp_email_created_idx
  on public.employee_login_otp_challenges(email, created_at desc);
create index if not exists employee_login_otp_ip_created_idx
  on public.employee_login_otp_challenges(request_ip_hash, created_at desc)
  where request_ip_hash <> '';

alter table public.employee_signup_otp_challenges enable row level security;
alter table public.employee_signup_requests enable row level security;
alter table public.employee_login_otp_challenges enable row level security;
revoke all on table public.employee_signup_otp_challenges,
  public.employee_signup_requests, public.employee_login_otp_challenges
  from public, anon, authenticated;
grant select, insert, update, delete on table public.employee_signup_otp_challenges,
  public.employee_signup_requests, public.employee_login_otp_challenges to service_role;

create or replace function public.employee_issue_signup_otp(
  p_id uuid,
  p_email text,
  p_otp_hash text,
  p_ip_hash text,
  p_expires_at timestamptz
) returns table(outcome text)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_ip_hash text := coalesce(p_ip_hash, '');
  v_email_count integer;
  v_ip_count integer;
  v_last_request timestamptz;
begin
  if p_id is null or v_email = '' or length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_otp_hash is null or p_otp_hash !~ '^[0-9a-f]{64}$'
     or (v_ip_hash <> '' and v_ip_hash !~ '^[0-9a-f]{64}$')
     or p_expires_at is null or p_expires_at <= now()
     or p_expires_at > now() + interval '10 minutes' then
    return query select 'invalid'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('staff-signup-otp:email:' || v_email, 0));
  if v_ip_hash <> '' then
    perform pg_advisory_xact_lock(hashtextextended('staff-signup-otp:ip:' || v_ip_hash, 0));
  end if;

  delete from public.employee_signup_otp_challenges
  where created_at < now() - interval '48 hours';
  select count(*), max(created_at)
    into v_email_count, v_last_request
  from public.employee_signup_otp_challenges
  where email = v_email and created_at > now() - interval '1 hour';
  if v_email_count >= 5 or
     (v_last_request is not null and v_last_request > now() - interval '60 seconds') then
    return query select 'limited'::text;
    return;
  end if;
  if v_ip_hash <> '' then
    select count(*) into v_ip_count
    from public.employee_signup_otp_challenges
    where request_ip_hash = v_ip_hash and created_at > now() - interval '1 hour';
    if v_ip_count >= 20 then
      return query select 'limited'::text;
      return;
    end if;
  end if;

  update public.employee_signup_otp_challenges
  set invalidated_at = now()
  where email = v_email and consumed_at is null and invalidated_at is null;
  insert into public.employee_signup_otp_challenges(
    id, email, otp_hash, request_ip_hash, expires_at
  ) values (p_id, v_email, p_otp_hash, v_ip_hash, p_expires_at);
  return query select 'issued'::text;
end
$$;

create or replace function public.employee_verify_signup_otp(
  p_id uuid,
  p_email text,
  p_otp_hash text,
  p_action_token_hash text
) returns table(outcome text)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_challenge public.employee_signup_otp_challenges%rowtype;
begin
  if p_id is null or p_email is null or p_otp_hash is null
     or p_otp_hash !~ '^[0-9a-f]{64}$'
     or p_action_token_hash is null or p_action_token_hash !~ '^[0-9a-f]{64}$' then
    return query select 'invalid'::text;
    return;
  end if;
  select * into v_challenge
  from public.employee_signup_otp_challenges
  where id = p_id and email = lower(trim(p_email))
  for update;
  if not found or v_challenge.invalidated_at is not null
     or v_challenge.consumed_at is not null or v_challenge.verified_at is not null
     or v_challenge.expires_at <= now() or v_challenge.attempt_count >= 5 then
    return query select 'invalid'::text;
    return;
  end if;
  if v_challenge.otp_hash <> p_otp_hash then
    update public.employee_signup_otp_challenges
    set attempt_count = attempt_count + 1,
        invalidated_at = case when attempt_count + 1 >= 5 then now() else invalidated_at end
    where id = p_id;
    return query select 'invalid'::text;
    return;
  end if;
  update public.employee_signup_otp_challenges
  set verified_at = now(),
      action_token_hash = p_action_token_hash,
      action_expires_at = now() + interval '10 minutes'
  where id = p_id;
  return query select 'verified'::text;
end
$$;

create or replace function public.employee_invalidate_signup_otp(
  p_id uuid,
  p_email text
) returns table(invalidated boolean)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_rows integer;
begin
  update public.employee_signup_otp_challenges
  set invalidated_at = now()
  where id = p_id and email = lower(trim(coalesce(p_email, '')))
    and verified_at is null and consumed_at is null and invalidated_at is null;
  get diagnostics v_rows = row_count;
  return query select v_rows = 1;
end
$$;

create or replace function public.employee_complete_signup(
  p_email text,
  p_action_token_hash text,
  p_full_name text,
  p_phone text,
  p_password_hash text
) returns table(outcome text)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_challenge public.employee_signup_otp_challenges%rowtype;
begin
  if v_email = '' or length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_action_token_hash is null or p_action_token_hash !~ '^[0-9a-f]{64}$'
     or p_full_name is null or length(trim(p_full_name)) not between 2 and 120
     or p_full_name ~ '[[:cntrl:]]'
     or p_phone is null or p_phone !~ '^254[17][0-9]{8}$'
     or p_password_hash is null
     or p_password_hash !~ '^scrypt\$[A-Za-z0-9_-]{16,32}\$[A-Za-z0-9_-]{80,100}$' then
    return query select 'invalid'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('staff-signup-otp:email:' || v_email, 0));
  select * into v_challenge
  from public.employee_signup_otp_challenges
  where email = v_email and action_token_hash = p_action_token_hash
    and verified_at is not null and action_expires_at > now()
    and consumed_at is null and invalidated_at is null
  for update;
  if not found then
    return query select 'invalid'::text;
    return;
  end if;

  update public.employee_signup_otp_challenges
  set consumed_at = now()
  where id = v_challenge.id;

  if exists (select 1 from public.employee_profiles where lower(trim(email)) = v_email)
     or exists (
       select 1 from public.employee_signup_requests
       where email = v_email and status = 'pending_approval'
     ) then
    return query select 'not_eligible'::text;
    return;
  end if;

  insert into public.employee_signup_requests(
    full_name, phone, email, password_hash, email_verified_at
  ) values (
    trim(p_full_name), p_phone, v_email, p_password_hash, v_challenge.verified_at
  );
  return query select 'accepted'::text;
end
$$;

create or replace function public.employee_issue_login_otp(
  p_id uuid,
  p_employee_id uuid,
  p_email text,
  p_otp_hash text,
  p_ip_hash text,
  p_expires_at timestamptz
) returns table(outcome text)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_ip_hash text := coalesce(p_ip_hash, '');
  v_email_count integer;
  v_ip_count integer;
  v_last_request timestamptz;
begin
  if p_id is null or p_employee_id is null or v_email = ''
     or length(v_email) > 254 or p_otp_hash is null
     or p_otp_hash !~ '^[0-9a-f]{64}$'
     or (v_ip_hash <> '' and v_ip_hash !~ '^[0-9a-f]{64}$')
     or p_expires_at is null or p_expires_at <= now()
     or p_expires_at > now() + interval '10 minutes' then
    return query select 'invalid'::text;
    return;
  end if;
  if not exists (
    select 1 from public.employee_profiles
    where id = p_employee_id and status = 'active' and lower(trim(email)) = v_email
  ) then
    return query select 'unavailable'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('staff-login-otp:email:' || v_email, 0));
  if v_ip_hash <> '' then
    perform pg_advisory_xact_lock(hashtextextended('staff-login-otp:ip:' || v_ip_hash, 0));
  end if;
  delete from public.employee_login_otp_challenges
  where created_at < now() - interval '48 hours';
  select count(*), max(created_at)
    into v_email_count, v_last_request
  from public.employee_login_otp_challenges
  where email = v_email and created_at > now() - interval '1 hour';
  if v_email_count >= 5 or
     (v_last_request is not null and v_last_request > now() - interval '60 seconds') then
    return query select 'limited'::text;
    return;
  end if;
  if v_ip_hash <> '' then
    select count(*) into v_ip_count
    from public.employee_login_otp_challenges
    where request_ip_hash = v_ip_hash and created_at > now() - interval '1 hour';
    if v_ip_count >= 20 then
      return query select 'limited'::text;
      return;
    end if;
  end if;

  update public.employee_login_otp_challenges
  set invalidated_at = now()
  where employee_id = p_employee_id and consumed_at is null and invalidated_at is null;
  insert into public.employee_login_otp_challenges(
    id, employee_id, email, otp_hash, request_ip_hash, expires_at
  ) values (p_id, p_employee_id, v_email, p_otp_hash, v_ip_hash, p_expires_at);
  return query select 'issued'::text;
end
$$;

create or replace function public.employee_verify_login_otp(
  p_id uuid,
  p_email text,
  p_otp_hash text
) returns table(outcome text, employee_id uuid)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_challenge public.employee_login_otp_challenges%rowtype;
  v_rows integer;
begin
  if p_id is null or p_email is null or p_otp_hash is null
     or p_otp_hash !~ '^[0-9a-f]{64}$' then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;
  select * into v_challenge
  from public.employee_login_otp_challenges
  where id = p_id and email = lower(trim(p_email))
  for update;
  if not found or v_challenge.invalidated_at is not null
     or v_challenge.consumed_at is not null
     or v_challenge.expires_at <= now() or v_challenge.attempt_count >= 5 then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;
  if v_challenge.otp_hash <> p_otp_hash then
    update public.employee_login_otp_challenges
    set attempt_count = attempt_count + 1,
        invalidated_at = case when attempt_count + 1 >= 5 then now() else invalidated_at end
    where id = p_id;
    return query select 'invalid'::text, null::uuid;
    return;
  end if;
  update public.employee_profiles
  set email_verified_at = coalesce(email_verified_at, now())
  where id = v_challenge.employee_id
    and status = 'active' and lower(trim(email)) = v_challenge.email;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    update public.employee_login_otp_challenges
    set invalidated_at = now()
    where id = p_id;
    return query select 'invalid'::text, null::uuid;
    return;
  end if;
  update public.employee_login_otp_challenges
  set consumed_at = now()
  where id = p_id;
  return query select 'verified'::text, v_challenge.employee_id;
end
$$;

create or replace function public.employee_invalidate_login_otp(
  p_id uuid,
  p_employee_id uuid
) returns table(invalidated boolean)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_rows integer;
begin
  update public.employee_login_otp_challenges
  set invalidated_at = now()
  where id = p_id and employee_id = p_employee_id
    and consumed_at is null and invalidated_at is null;
  get diagnostics v_rows = row_count;
  return query select v_rows = 1;
end
$$;

create or replace function public.employee_review_signup_request(
  p_request_id uuid,
  p_decision text,
  p_review_note text,
  p_actor_id text
) returns table(outcome text, email text, employee_id uuid)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.employee_signup_requests%rowtype;
  v_employee_id uuid;
  v_suffix text;
  v_username text;
  v_email text;
begin
  if p_request_id is null or p_decision not in ('approve', 'reject')
     or coalesce(p_actor_id, '') = ''
     or length(coalesce(p_review_note, '')) > 500 then
    return query select 'invalid'::text, null::text, null::uuid;
    return;
  end if;
  select * into v_request
  from public.employee_signup_requests
  where id = p_request_id and status = 'pending_approval'
  for update;
  if not found or v_request.email_verified_at is null then
    return query select 'invalid'::text, null::text, null::uuid;
    return;
  end if;

  v_email := v_request.email;
  perform pg_advisory_xact_lock(hashtextextended('staff-signup-otp:email:' || v_email, 0));
  if p_decision = 'reject' then
    update public.employee_signup_requests
    set status = 'rejected', password_hash = null, reviewed_by = p_actor_id,
        reviewed_at = now(), review_note = nullif(trim(coalesce(p_review_note, '')), '')
    where id = p_request_id;
    insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id)
    values ('super_admin', p_actor_id, 'staff_signup_rejected', 'staff_signup_request', p_request_id::text);
    return query select 'rejected'::text, v_email, null::uuid;
    return;
  end if;

  if v_request.password_hash is null or exists (
    select 1 from public.employee_profiles where lower(trim(email)) = v_email
  ) then
    update public.employee_signup_requests
    set status = 'rejected', password_hash = null, reviewed_by = p_actor_id,
        reviewed_at = now(), review_note = 'The email address is already assigned to a Staff account.'
    where id = p_request_id;
    insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id)
    values ('super_admin', p_actor_id, 'staff_signup_rejected_duplicate', 'staff_signup_request', p_request_id::text);
    return query select 'duplicate'::text, v_email, null::uuid;
    return;
  end if;

  v_employee_id := gen_random_uuid();
  v_suffix := upper(left(replace(v_employee_id::text, '-', ''), 12));
  v_username := 'staff' || lower(v_suffix);
  insert into public.employee_profiles(
    id, employee_number, username, display_name, email, phone, subdomain,
    status, fixed_monthly_salary, created_by, email_verified_at
  ) values (
    v_employee_id, 'STAFF-' || left(v_suffix, 10), v_username, v_request.full_name,
    v_email, v_request.phone, 'staff-' || lower(v_suffix),
    'active', 0, p_actor_id, v_request.email_verified_at
  );
  insert into public.employee_credentials(employee_id, password_hash, must_change_password)
  values (v_employee_id, v_request.password_hash, false);
  update public.employee_signup_requests
  set status = 'approved', password_hash = null, employee_id = v_employee_id,
      reviewed_by = p_actor_id, reviewed_at = now(),
      review_note = nullif(trim(coalesce(p_review_note, '')), '')
  where id = p_request_id;
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
  values (
    'super_admin', p_actor_id, 'staff_signup_approved',
    'staff_signup_request', p_request_id::text,
    jsonb_build_object('staff_id', v_employee_id)
  );
  return query select 'approved'::text, v_email, v_employee_id;
end
$$;

create or replace function public.employee_update_staff_contact(
  p_employee_id uuid,
  p_email text,
  p_phone text,
  p_actor_id text
) returns table(outcome text, employee_id uuid, email text, phone text)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
begin
  if p_employee_id is null or v_email = '' or length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or (v_phone is not null and v_phone !~ '^254[17][0-9]{8}$')
     or coalesce(p_actor_id, '') = '' then
    return query select 'invalid'::text, null::uuid, null::text, null::text;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-signup-otp:email:' || v_email, 0));
  if exists (
    select 1 from public.employee_profiles
    where lower(trim(email)) = v_email and id <> p_employee_id
  ) then
    return query select 'duplicate'::text, null::uuid, null::text, null::text;
    return;
  end if;
  update public.employee_profiles
  set email = v_email,
      phone = v_phone,
      email_verified_at = null,
      auth_version = auth_version + 1,
      updated_at = now()
  where id = p_employee_id and status in ('active', 'invited')
  returning public.employee_profiles.id, public.employee_profiles.email, public.employee_profiles.phone
  into employee_id, email, phone;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
  values (
    'super_admin', p_actor_id, 'staff_contact_updated', 'staff', p_employee_id::text,
    jsonb_build_object('email_changed', true, 'phone_changed', true, 'sessions_invalidated', true)
  );
  return query select 'updated'::text, employee_id, email, phone;
end
$$;

revoke all on function public.employee_issue_signup_otp(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.employee_verify_signup_otp(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.employee_invalidate_signup_otp(uuid, text) from public, anon, authenticated;
revoke all on function public.employee_complete_signup(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.employee_issue_login_otp(uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.employee_verify_login_otp(uuid, text, text) from public, anon, authenticated;
revoke all on function public.employee_invalidate_login_otp(uuid, uuid) from public, anon, authenticated;
revoke all on function public.employee_review_signup_request(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.employee_update_staff_contact(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.employee_issue_signup_otp(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.employee_verify_signup_otp(uuid, text, text, text) to service_role;
grant execute on function public.employee_invalidate_signup_otp(uuid, text) to service_role;
grant execute on function public.employee_complete_signup(text, text, text, text, text) to service_role;
grant execute on function public.employee_issue_login_otp(uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.employee_verify_login_otp(uuid, text, text) to service_role;
grant execute on function public.employee_invalidate_login_otp(uuid, uuid) to service_role;
grant execute on function public.employee_review_signup_request(uuid, text, text, text) to service_role;
grant execute on function public.employee_update_staff_contact(uuid, text, text, text) to service_role;
