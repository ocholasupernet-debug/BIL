-- Queue welcome, account-lifecycle and password-change notices without sending
-- WhatsApp messages from database transactions. Webhook claims are retryable,
-- but completed provider events remain idempotent.

alter table whatsapp_webhook_events
  add column if not exists processing_status text not null default 'processed',
  add column if not exists attempts integer not null default 0,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists processed_at timestamptz,
  add column if not exists failure_code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_webhook_events_processing_status_check'
      and conrelid = 'whatsapp_webhook_events'::regclass
  ) then
    alter table whatsapp_webhook_events
      add constraint whatsapp_webhook_events_processing_status_check
      check (processing_status in ('processing', 'processed', 'failed'));
  end if;
end $$;

create index if not exists whatsapp_webhook_events_retry_idx
  on whatsapp_webhook_events(processing_status, updated_at)
  where processing_status in ('processing', 'failed');

drop function if exists claim_whatsapp_webhook_event(text, text, text);
create function claim_whatsapp_webhook_event(
  p_provider_event_id text,
  p_sender_phone text,
  p_event_type text
)
returns table(should_process boolean, attempts integer, processing_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
begin
  if coalesce(trim(p_provider_event_id), '') = '' then
    return query select false, 0, 'failed'::text;
    return;
  end if;

  insert into whatsapp_webhook_events as existing(
    provider_event_id,
    sender_phone_e164,
    event_type,
    processing_status,
    attempts,
    updated_at
  ) values (
    left(p_provider_event_id, 240),
    left(coalesce(p_sender_phone, ''), 20),
    left(coalesce(p_event_type, 'unknown'), 40),
    'processing',
    1,
    now()
  )
  on conflict (provider_event_id) do update
    set sender_phone_e164 = excluded.sender_phone_e164,
        event_type = excluded.event_type,
        processing_status = 'processing',
        attempts = existing.attempts + 1,
        updated_at = now(),
        processed_at = null,
        failure_code = null
    where (
      existing.processing_status = 'failed'
      and existing.attempts < 5
    ) or (
      existing.processing_status = 'processing'
      and existing.updated_at < now() - interval '5 minutes'
      and existing.attempts < 5
    )
  returning existing.attempts into v_attempts;

  if found then
    return query select true, v_attempts, 'processing'::text;
    return;
  end if;

  select e.attempts, e.processing_status
    into v_attempts, processing_status
  from whatsapp_webhook_events e
  where e.provider_event_id = left(p_provider_event_id, 240);
  return query select false, coalesce(v_attempts, 0), coalesce(processing_status, 'failed');
end
$$;

create or replace function complete_whatsapp_webhook_event(p_provider_event_id text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update whatsapp_webhook_events
  set processing_status = 'processed',
      processed_at = now(),
      updated_at = now(),
      failure_code = null
  where provider_event_id = left(p_provider_event_id, 240)
    and processing_status = 'processing';
$$;

create or replace function fail_whatsapp_webhook_event(
  p_provider_event_id text,
  p_failure_code text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update whatsapp_webhook_events
  set processing_status = 'failed',
      updated_at = now(),
      failure_code = left(regexp_replace(coalesce(p_failure_code, 'processing_error'), '[^A-Za-z0-9_-]', '', 'g'), 48)
  where provider_event_id = left(p_provider_event_id, 240)
    and processing_status = 'processing';
$$;

create or replace function enqueue_whatsapp_isp_welcome()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_reseller boolean;
  v_enabled boolean;
  v_event_type text;
begin
  if not coalesce(new.is_active, false)
     or lower(coalesce(new.status, '')) <> 'active'
     or not coalesce(new.phone_verified, false)
     or coalesce(new.phone_e164, '') !~ '^\+[1-9][0-9]{7,14}$' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and coalesce(old.is_active, false)
     and lower(coalesce(old.status, '')) = 'active'
     and coalesce(old.phone_verified, false) then
    return new;
  end if;

  v_is_reseller := lower(coalesce(new.role, '')) = 'reseller';
  v_event_type := case when v_is_reseller then 'reseller_welcome' else 'isp_welcome' end;
  select coalesce((config->>'enabled')::boolean, false)
      and coalesce((config->'features'->>case when v_is_reseller then 'resellerNotifications' else 'ispNotifications' end)::boolean, false)
    into v_enabled
  from platform_whatsapp_settings
  where id = 'global_whatsapp';
  if not coalesce(v_enabled, false) then return new; end if;

  insert into whatsapp_outbox(
    id, dedupe_key, event_type, customer_id, admin_id, phone_e164, payload
  ) values (
    gen_random_uuid(),
    'account-welcome:' || new.id::text,
    v_event_type,
    null,
    new.id,
    new.phone_e164,
    jsonb_build_object(
      'name', coalesce(nullif(new.fullname, ''), nullif(new.name, ''), new.username, ''),
      'username', coalesce(new.username, ''),
      'company_name', coalesce(new.company_name, ''),
      'subdomain', coalesce(new.subdomain, ''),
      'role', lower(coalesce(new.role, 'isp_admin')),
      'must_change_password', coalesce(new.must_change_password, false)
    )
  )
  on conflict (dedupe_key) do nothing;
  return new;
exception when others then
  raise warning 'WhatsApp welcome outbox insert failed: %', sqlstate;
  return new;
end
$$;

create or replace function enqueue_whatsapp_customer_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_status text := '';
  v_new_status text;
  v_event_type text;
  v_enabled boolean;
begin
  v_new_status := lower(coalesce(new.status, ''));
  if tg_op = 'UPDATE' then
    v_old_status := lower(coalesce(old.status, ''));
    if v_old_status = v_new_status then return new; end if;
  end if;

  if v_new_status = 'active' then
    v_event_type := case
      when v_old_status in ('suspended', 'disabled', 'inactive', 'expired') then 'account_reactivated'
      else 'account_activated'
    end;
  elsif v_old_status = 'active' and v_new_status in ('suspended', 'disabled', 'inactive') then
    v_event_type := 'account_suspended';
  else
    return new;
  end if;

  if not coalesce(new.phone_verified, false)
     or coalesce(new.phone_e164, '') !~ '^\+[1-9][0-9]{7,14}$' then
    return new;
  end if;
  select coalesce((config->>'enabled')::boolean, false)
      and coalesce((config->'features'->>'customerNotifications')::boolean, false)
    into v_enabled
  from platform_whatsapp_settings
  where id = 'global_whatsapp';
  if not coalesce(v_enabled, false) then return new; end if;

  insert into whatsapp_outbox(
    id, dedupe_key, event_type, customer_id, admin_id, phone_e164, payload
  ) values (
    gen_random_uuid(),
    'customer-lifecycle:' || new.id::text || ':' ||
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'),
    v_event_type,
    new.id,
    null,
    new.phone_e164,
    jsonb_build_object(
      'previous_status', v_old_status,
      'status', v_new_status,
      'effective_at', now(),
      'plan_id', new.plan_id
    )
  )
  on conflict (dedupe_key) do nothing;
  return new;
exception when others then
  raise warning 'WhatsApp customer lifecycle outbox insert failed: %', sqlstate;
  return new;
end
$$;

create or replace function enqueue_whatsapp_admin_password_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
begin
  if new.password is not distinct from old.password
     or not coalesce(new.phone_verified, false)
     or coalesce(new.phone_e164, '') !~ '^\+[1-9][0-9]{7,14}$' then
    return new;
  end if;
  select coalesce((config->>'enabled')::boolean, false)
      and coalesce((config->'features'->>'securityNotifications')::boolean, false)
    into v_enabled
  from platform_whatsapp_settings
  where id = 'global_whatsapp';
  if not coalesce(v_enabled, false) then return new; end if;

  insert into whatsapp_outbox(
    id, dedupe_key, event_type, customer_id, admin_id, phone_e164, payload
  ) values (
    gen_random_uuid(),
    'password-change:admin:' || new.id::text || ':' ||
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'),
    'password_changed',
    null,
    new.id,
    new.phone_e164,
    jsonb_build_object('changed_at', now())
  )
  on conflict (dedupe_key) do nothing;
  return new;
exception when others then
  raise warning 'WhatsApp admin password notice insert failed: %', sqlstate;
  return new;
end
$$;

create or replace function enqueue_whatsapp_customer_password_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
begin
  if new.password is not distinct from old.password
     or not coalesce(new.phone_verified, false)
     or coalesce(new.phone_e164, '') !~ '^\+[1-9][0-9]{7,14}$' then
    return new;
  end if;
  select coalesce((config->>'enabled')::boolean, false)
      and coalesce((config->'features'->>'securityNotifications')::boolean, false)
    into v_enabled
  from platform_whatsapp_settings
  where id = 'global_whatsapp';
  if not coalesce(v_enabled, false) then return new; end if;

  insert into whatsapp_outbox(
    id, dedupe_key, event_type, customer_id, admin_id, phone_e164, payload
  ) values (
    gen_random_uuid(),
    'password-change:customer:' || new.id::text || ':' ||
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'),
    'password_changed',
    new.id,
    null,
    new.phone_e164,
    jsonb_build_object('changed_at', now())
  )
  on conflict (dedupe_key) do nothing;
  return new;
exception when others then
  raise warning 'WhatsApp customer password notice insert failed: %', sqlstate;
  return new;
end
$$;

drop trigger if exists isp_admins_whatsapp_welcome on isp_admins;
create trigger isp_admins_whatsapp_welcome
  after insert or update on isp_admins
  for each row execute function enqueue_whatsapp_isp_welcome();

drop trigger if exists isp_customers_whatsapp_lifecycle on isp_customers;
create trigger isp_customers_whatsapp_lifecycle
  after insert or update of status on isp_customers
  for each row execute function enqueue_whatsapp_customer_lifecycle();

drop trigger if exists isp_admins_whatsapp_password_change on isp_admins;
create trigger isp_admins_whatsapp_password_change
  after update of password on isp_admins
  for each row execute function enqueue_whatsapp_admin_password_change();

drop trigger if exists isp_customers_whatsapp_password_change on isp_customers;
create trigger isp_customers_whatsapp_password_change
  after update of password on isp_customers
  for each row execute function enqueue_whatsapp_customer_password_change();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function claim_whatsapp_webhook_event(text, text, text) from anon;
    revoke all on function complete_whatsapp_webhook_event(text) from anon;
    revoke all on function fail_whatsapp_webhook_event(text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function claim_whatsapp_webhook_event(text, text, text) from authenticated;
    revoke all on function complete_whatsapp_webhook_event(text) from authenticated;
    revoke all on function fail_whatsapp_webhook_event(text, text) from authenticated;
  end if;
  revoke all on function claim_whatsapp_webhook_event(text, text, text) from public;
  revoke all on function complete_whatsapp_webhook_event(text) from public;
  revoke all on function fail_whatsapp_webhook_event(text, text) from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on table whatsapp_webhook_events to service_role;
    grant execute on function claim_whatsapp_webhook_event(text, text, text) to service_role;
    grant execute on function complete_whatsapp_webhook_event(text) to service_role;
    grant execute on function fail_whatsapp_webhook_event(text, text) to service_role;
  end if;
end $$;