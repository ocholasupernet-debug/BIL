-- Super Admin-managed WhatsApp credentials are encrypted by the API before
-- storage. This table is service-role-only; ciphertext is never returned by
-- the API.
create table if not exists platform_whatsapp_credentials (
  id text primary key check (id = 'global_whatsapp'),
  access_token jsonb,
  webhook_verify_token jsonb,
  app_secret jsonb,
  updated_at timestamptz not null default now()
);

alter table platform_whatsapp_credentials enable row level security;

create table if not exists whatsapp_gateway_settings_otps (
  id uuid primary key,
  account_id bigint not null,
  phone_e164 text not null,
  auth_request_id uuid not null,
  session_binding_hash text not null check (session_binding_hash ~ '^[0-9a-f]{64}$'),
  otp_hash text not null check (otp_hash ~ '^[0-9a-f]{64}$'),
  request_ip_hash text not null default '',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_gateway_settings_otp_account_created_idx
  on whatsapp_gateway_settings_otps(account_id, created_at desc);
create index if not exists whatsapp_gateway_settings_otp_ip_created_idx
  on whatsapp_gateway_settings_otps(request_ip_hash, created_at desc);

create table if not exists whatsapp_gateway_settings_grants (
  grant_hash text primary key check (grant_hash ~ '^[0-9a-f]{64}$'),
  account_id bigint not null,
  auth_request_id uuid not null,
  session_binding_hash text not null check (session_binding_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_gateway_settings_grants_expiry_idx
  on whatsapp_gateway_settings_grants(expires_at);

alter table whatsapp_gateway_settings_otps enable row level security;
alter table whatsapp_gateway_settings_grants enable row level security;

create or replace function issue_whatsapp_gateway_settings_otp(
  p_id uuid,
  p_account_id bigint,
  p_phone_e164 text,
  p_auth_request_id uuid,
  p_session_binding_hash text,
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
begin
  if p_account_id <= 0
     or p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
     or p_session_binding_hash !~ '^[0-9a-f]{64}$'
     or p_otp_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at <= now()
     or p_expires_at > now() + interval '5 minutes' then
    return query select 'invalid'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text || ':' || p_phone_e164, 0));
  select count(*), max(created_at)
    into v_account_count, v_last_request
  from whatsapp_gateway_settings_otps
  where account_id = p_account_id
    and created_at > now() - interval '1 hour';

  if v_account_count >= 5 or (v_last_request is not null and v_last_request > now() - interval '60 seconds') then
    return query select 'limited'::text;
    return;
  end if;

  if coalesce(p_ip_hash, '') <> '' then
    select count(*) into v_ip_count
    from whatsapp_gateway_settings_otps
    where request_ip_hash = p_ip_hash
      and created_at > now() - interval '1 hour';
    if v_ip_count >= 20 then
      return query select 'limited'::text;
      return;
    end if;
  end if;

  update whatsapp_gateway_settings_otps
    set invalidated_at = now()
    where account_id = p_account_id
      and consumed_at is null
      and invalidated_at is null;

  insert into whatsapp_gateway_settings_otps(
    id, account_id, phone_e164, auth_request_id, session_binding_hash,
    otp_hash, request_ip_hash, expires_at
  ) values (
    p_id, p_account_id, p_phone_e164, p_auth_request_id, p_session_binding_hash,
    p_otp_hash, coalesce(p_ip_hash, ''), p_expires_at
  );
  return query select 'issued'::text;
end
$$;

create or replace function verify_whatsapp_gateway_settings_otp(
  p_id uuid,
  p_account_id bigint,
  p_auth_request_id uuid,
  p_session_binding_hash text,
  p_otp_hash text,
  p_max_attempts integer default 5
)
returns table(outcome text, phone_e164 text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge whatsapp_gateway_settings_otps%rowtype;
begin
  select * into v_challenge
  from whatsapp_gateway_settings_otps
  where id = p_id
  for update;

  if not found
     or v_challenge.account_id <> p_account_id
     or v_challenge.auth_request_id <> p_auth_request_id
     or v_challenge.session_binding_hash <> p_session_binding_hash then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  if v_challenge.consumed_at is not null or v_challenge.invalidated_at is not null then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  if v_challenge.expires_at <= now() then
    update whatsapp_gateway_settings_otps set consumed_at = now() where id = p_id;
    return query select 'expired'::text, null::text;
    return;
  end if;

  if v_challenge.attempt_count >= greatest(1, least(p_max_attempts, 5)) then
    update whatsapp_gateway_settings_otps set consumed_at = now() where id = p_id;
    return query select 'invalid'::text, null::text;
    return;
  end if;

  if v_challenge.otp_hash <> p_otp_hash then
    update whatsapp_gateway_settings_otps
      set attempt_count = attempt_count + 1,
          consumed_at = case
            when attempt_count + 1 >= greatest(1, least(p_max_attempts, 5)) then now()
            else null
          end
      where id = p_id;
    return query select 'invalid'::text, null::text;
    return;
  end if;

  update whatsapp_gateway_settings_otps
    set consumed_at = now()
    where id = p_id;
  return query select 'verified'::text, v_challenge.phone_e164;
end
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table platform_whatsapp_credentials from anon;
    revoke all on table whatsapp_gateway_settings_otps from anon;
    revoke all on table whatsapp_gateway_settings_grants from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table platform_whatsapp_credentials from authenticated;
    revoke all on table whatsapp_gateway_settings_otps from authenticated;
    revoke all on table whatsapp_gateway_settings_grants from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table platform_whatsapp_credentials to service_role;
    grant select, insert, update, delete on table whatsapp_gateway_settings_otps to service_role;
    grant select, insert, update, delete on table whatsapp_gateway_settings_grants to service_role;
    grant execute on function issue_whatsapp_gateway_settings_otp(uuid, bigint, text, uuid, text, text, text, timestamptz) to service_role;
    grant execute on function verify_whatsapp_gateway_settings_otp(uuid, bigint, uuid, text, text, integer) to service_role;
  end if;
end $$;