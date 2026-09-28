-- WhatsApp Cloud API configuration, OTP challenges, webhook receipts and an
-- asynchronous notification outbox. Provider credentials stay in server env.

alter table isp_admins
  add column if not exists phone_e164 text,
  add column if not exists phone_verified boolean not null default false,
  add column if not exists phone_verified_at timestamptz;

alter table isp_customers
  add column if not exists phone_e164 text,
  add column if not exists phone_verified boolean not null default false,
  add column if not exists phone_verified_at timestamptz;

update isp_admins
set phone_e164 = case
  when regexp_replace(coalesce(phone, ''), '\D', '', 'g') ~ '^0[17][0-9]{8}$'
    then '+254' || substr(regexp_replace(phone, '\D', '', 'g'), 2)
  when regexp_replace(coalesce(phone, ''), '\D', '', 'g') ~ '^254[17][0-9]{8}$'
    then '+' || regexp_replace(phone, '\D', '', 'g')
  else phone_e164
end
where phone_e164 is null and phone is not null;

update isp_customers
set phone_e164 = case
  when regexp_replace(coalesce(phone, ''), '\D', '', 'g') ~ '^0[17][0-9]{8}$'
    then '+254' || substr(regexp_replace(phone, '\D', '', 'g'), 2)
  when regexp_replace(coalesce(phone, ''), '\D', '', 'g') ~ '^254[17][0-9]{8}$'
    then '+' || regexp_replace(phone, '\D', '', 'g')
  else phone_e164
end
where phone_e164 is null and phone is not null;

create index if not exists isp_admins_phone_e164_idx on isp_admins(phone_e164);
create index if not exists isp_customers_phone_e164_idx on isp_customers(phone_e164);

create table if not exists platform_whatsapp_settings (
  id text primary key check (id = 'global_whatsapp'),
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists whatsapp_otp_challenges (
  id uuid primary key,
  phone_e164 text not null,
  purpose text not null check (purpose in ('login', 'registration', 'recovery')),
  account_type text check (account_type in ('admin', 'customer')),
  account_id bigint,
  otp_hash text not null,
  request_ip_hash text not null default '',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  expires_at timestamptz not null,
  verified_at timestamptz,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_otp_phone_created_idx
  on whatsapp_otp_challenges(phone_e164, purpose, created_at desc);
create index if not exists whatsapp_otp_ip_created_idx
  on whatsapp_otp_challenges(request_ip_hash, created_at desc);

create table if not exists whatsapp_action_tokens (
  token_hash text primary key,
  phone_e164 text not null,
  purpose text not null check (purpose in ('registration', 'recovery')),
  account_type text check (account_type in ('admin', 'customer')),
  account_id bigint,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_action_tokens_expiry_idx
  on whatsapp_action_tokens(expires_at);

create table if not exists whatsapp_outbox (
  id uuid primary key,
  dedupe_key text not null unique,
  event_type text not null,
  customer_id bigint,
  admin_id bigint,
  phone_e164 text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  provider_message_id text,
  provider_status text,
  provider_status_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists whatsapp_outbox_claim_idx
  on whatsapp_outbox(status, available_at, created_at);
create index if not exists whatsapp_outbox_provider_id_idx
  on whatsapp_outbox(provider_message_id);

create table if not exists whatsapp_webhook_events (
  id bigint generated always as identity primary key,
  provider_event_id text not null unique,
  sender_phone_e164 text,
  event_type text not null,
  received_at timestamptz not null default now()
);

alter table platform_whatsapp_settings enable row level security;
alter table whatsapp_otp_challenges enable row level security;
alter table whatsapp_action_tokens enable row level security;
alter table whatsapp_outbox enable row level security;
alter table whatsapp_webhook_events enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table platform_whatsapp_settings from anon;
    revoke all on table whatsapp_otp_challenges from anon;
    revoke all on table whatsapp_action_tokens from anon;
    revoke all on table whatsapp_outbox from anon;
    revoke all on table whatsapp_webhook_events from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table platform_whatsapp_settings from authenticated;
    revoke all on table whatsapp_otp_challenges from authenticated;
    revoke all on table whatsapp_action_tokens from authenticated;
    revoke all on table whatsapp_outbox from authenticated;
    revoke all on table whatsapp_webhook_events from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table platform_whatsapp_settings to service_role;
    grant select, insert, update, delete on table whatsapp_otp_challenges to service_role;
    grant select, insert, update, delete on table whatsapp_action_tokens to service_role;
    grant select, insert, update, delete on table whatsapp_outbox to service_role;
    grant select, insert, update, delete on table whatsapp_webhook_events to service_role;
    grant usage, select on sequence whatsapp_webhook_events_id_seq to service_role;
  end if;
end $$;

create or replace function issue_whatsapp_otp(
  p_id uuid,
  p_phone_e164 text,
  p_purpose text,
  p_account_type text,
  p_account_id bigint,
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
  v_phone_count integer;
  v_ip_count integer;
  v_last_request timestamptz;
begin
  if p_purpose not in ('login', 'registration', 'recovery')
     or p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
     or p_otp_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at <= now()
     or p_expires_at > now() + interval '15 minutes' then
    return query select 'invalid'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_phone_e164 || ':' || p_purpose, 0));
  select count(*), max(created_at)
    into v_phone_count, v_last_request
  from whatsapp_otp_challenges
  where phone_e164 = p_phone_e164
    and purpose = p_purpose
    and created_at > now() - interval '1 hour';

  if v_phone_count >= 5 or (v_last_request is not null and v_last_request > now() - interval '60 seconds') then
    return query select 'limited'::text;
    return;
  end if;

  if coalesce(p_ip_hash, '') <> '' then
    select count(*) into v_ip_count
    from whatsapp_otp_challenges
    where request_ip_hash = p_ip_hash
      and created_at > now() - interval '1 hour';
    if v_ip_count >= 20 then
      return query select 'limited'::text;
      return;
    end if;
  end if;

  update whatsapp_otp_challenges
    set invalidated_at = now()
    where phone_e164 = p_phone_e164
      and purpose = p_purpose
      and consumed_at is null
      and invalidated_at is null;

  insert into whatsapp_otp_challenges(
    id, phone_e164, purpose, account_type, account_id, otp_hash,
    request_ip_hash, expires_at
  ) values (
    p_id, p_phone_e164, p_purpose, p_account_type, p_account_id, p_otp_hash,
    coalesce(p_ip_hash, ''), p_expires_at
  );
  return query select 'issued'::text;
end
$$;

create or replace function verify_whatsapp_otp(
  p_id uuid,
  p_otp_hash text,
  p_max_attempts integer default 5
)
returns table(
  outcome text,
  purpose text,
  account_type text,
  account_id bigint,
  phone_e164 text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_challenge whatsapp_otp_challenges%rowtype;
begin
  select * into v_challenge
  from whatsapp_otp_challenges
  where id = p_id
  for update;

  if not found then
    return query select 'invalid'::text, null::text, null::text, null::bigint, null::text;
    return;
  end if;

  if v_challenge.consumed_at is not null or v_challenge.invalidated_at is not null then
    return query select 'invalid'::text, null::text, null::text, null::bigint, null::text;
    return;
  end if;

  if v_challenge.expires_at <= now() then
    update whatsapp_otp_challenges set consumed_at = now() where id = p_id;
    return query select 'expired'::text, null::text, null::text, null::bigint, null::text;
    return;
  end if;

  if v_challenge.attempt_count >= greatest(1, least(p_max_attempts, 10)) then
    update whatsapp_otp_challenges set consumed_at = now() where id = p_id;
    return query select 'invalid'::text, null::text, null::text, null::bigint, null::text;
    return;
  end if;

  if v_challenge.otp_hash <> p_otp_hash then
    update whatsapp_otp_challenges
      set attempt_count = attempt_count + 1,
          consumed_at = case when attempt_count + 1 >= greatest(1, least(p_max_attempts, 10)) then now() else null end
      where id = p_id;
    return query select 'invalid'::text, null::text, null::text, null::bigint, null::text;
    return;
  end if;

  update whatsapp_otp_challenges set consumed_at = now(), verified_at = now() where id = p_id;
  return query select
    'verified'::text,
    v_challenge.purpose,
    v_challenge.account_type,
    v_challenge.account_id,
    v_challenge.phone_e164;
end
$$;

create or replace function consume_whatsapp_action_token(
  p_token_hash text,
  p_phone_e164 text,
  p_purpose text
)
returns table(consumed boolean, account_type text, account_id bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token whatsapp_action_tokens%rowtype;
begin
  select * into v_token
  from whatsapp_action_tokens
  where token_hash = p_token_hash
    and (p_phone_e164 = '' or phone_e164 = p_phone_e164)
    and purpose = p_purpose
    and consumed_at is null
    and expires_at > now()
  for update;

  if not found then
    return query select false, null::text, null::bigint;
    return;
  end if;

  update whatsapp_action_tokens set consumed_at = now() where token_hash = p_token_hash;
  return query select true, v_token.account_type, v_token.account_id;
end
$$;

drop function if exists claim_whatsapp_outbox(integer);
create or replace function claim_whatsapp_outbox(
  p_limit integer default 10,
  p_event_types text[] default null
)
returns table(
  id uuid,
  dedupe_key text,
  event_type text,
  customer_id bigint,
  admin_id bigint,
  phone_e164 text,
  payload jsonb,
  attempts integer
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with stale as (
    update whatsapp_outbox
    set status = 'failed',
        error_code = 'expired',
        error_message = 'Notification expired before delivery.'
    where status = 'queued'
      and created_at < now() - interval '48 hours'
    returning id
  ),
  due as (
    select q.id
    from whatsapp_outbox q
    where (
      (q.status = 'queued' and q.available_at <= now())
      or (q.status = 'sending' and q.locked_at < now() - interval '5 minutes')
    )
      and q.created_at >= now() - interval '48 hours'
      and (p_event_types is null or q.event_type = any(p_event_types))
      and q.attempts < 8
    order by q.available_at, q.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update whatsapp_outbox q
  set status = 'sending',
      locked_at = now(),
      attempts = q.attempts + 1
  from due
  where q.id = due.id
  returning q.id, q.dedupe_key, q.event_type, q.customer_id,
            q.admin_id, q.phone_e164, q.payload, q.attempts;
$$;

create or replace function complete_whatsapp_outbox(
  p_id uuid,
  p_status text,
  p_message_id text,
  p_error_code text,
  p_error_message text,
  p_retryable boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
  v_retry boolean;
begin
  select attempts into v_attempts from whatsapp_outbox where id = p_id for update;
  if not found then return; end if;
  v_retry := p_status <> 'sent' and coalesce(p_retryable, false) and v_attempts < 8;

  update whatsapp_outbox
  set status = case when p_status = 'sent' then 'sent' when v_retry then 'queued' else 'failed' end,
      provider_message_id = case when p_status = 'sent' then p_message_id else provider_message_id end,
      error_code = case when p_status = 'sent' then null else left(p_error_code, 40) end,
      error_message = case when p_status = 'sent' then null else left(p_error_message, 200) end,
      available_at = case when v_retry
        then now() + make_interval(secs => least(3600, 15 * power(2, greatest(v_attempts - 1, 0))::integer))
        else available_at
      end,
      locked_at = null,
      sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_id;
end
$$;

create or replace function record_whatsapp_webhook_message(
  p_provider_message_id text,
  p_sender_phone text,
  p_event_type text
)
returns table(is_new boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer;
begin
  insert into whatsapp_webhook_events(provider_event_id, sender_phone_e164, event_type)
  values (left(p_provider_message_id, 240), left(p_sender_phone, 20), left(p_event_type, 40))
  on conflict (provider_event_id) do nothing;
  get diagnostics v_inserted = row_count;
  return query select v_inserted = 1;
end
$$;

create or replace function enqueue_whatsapp_expiry_notifications()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_global_enabled boolean;
  v_customer_enabled boolean;
  v_package_enabled boolean;
  v_isp_enabled boolean;
  v_reseller_enabled boolean;
  v_count integer;
  v_invoice_count integer := 0;
begin
  select coalesce((config->>'enabled')::boolean, false),
      coalesce((config->'features'->>'customerNotifications')::boolean, false),
      coalesce((config->'features'->>'packageNotifications')::boolean, false),
      coalesce((config->'features'->>'ispNotifications')::boolean, false),
      coalesce((config->'features'->>'resellerNotifications')::boolean, false)
    into v_global_enabled, v_customer_enabled, v_package_enabled,
         v_isp_enabled, v_reseller_enabled
  from platform_whatsapp_settings
  where id = 'global_whatsapp';
  if not coalesce(v_global_enabled, false) then return 0; end if;

  v_count := 0;
  if v_customer_enabled and v_package_enabled then
    insert into whatsapp_outbox(
      id, dedupe_key, event_type, customer_id, admin_id, phone_e164, payload
    )
    select
      gen_random_uuid(),
      'expiry:' || c.id::text || ':' || to_char(c.expires_at at time zone 'UTC', 'YYYYMMDDHH24MI'),
      'expiry',
      c.id,
      c.admin_id,
      null,
      jsonb_build_object(
        'expires_at', c.expires_at,
        'days_remaining', greatest(1, ceil(extract(epoch from (c.expires_at - now())) / 86400)::integer),
        'plan_id', c.plan_id
      )
    from isp_customers c
    where c.status = 'active'
      and c.phone_verified is true
      and c.phone_e164 is not null
      and c.expires_at > now()
      and c.expires_at <= now() + interval '48 hours'
    on conflict (dedupe_key) do nothing;
    get diagnostics v_count = row_count;
  end if;

  if v_isp_enabled or v_reseller_enabled then
    insert into whatsapp_outbox(
      id, dedupe_key, event_type, customer_id, admin_id, phone_e164, payload
    )
    select
      gen_random_uuid(),
      'platform-invoice-reminder:' || i.id::text,
      case when a.role = 'reseller' then 'reseller_subscription' else 'isp_subscription' end,
      null,
      a.id,
      null,
      jsonb_build_object(
        'amount', i.amount_due,
        'billing_period', to_char(i.billing_period, 'YYYY-MM'),
        'status', 'due',
        'due_date', i.due_date
      )
    from platform_billing_invoices i
    join isp_admins a on a.id = i.account_id
    where i.status in ('due', 'pending')
      and i.due_date between current_date - 3 and current_date + 3
      and a.phone_verified is true
      and a.phone_e164 is not null
      and ((a.role = 'reseller' and v_reseller_enabled)
        or (a.role <> 'reseller' and v_isp_enabled))
    on conflict (dedupe_key) do nothing;
    get diagnostics v_invoice_count = row_count;
  end if;
  return coalesce(v_count, 0) + coalesce(v_invoice_count, 0);
end
$$;

create or replace function whatsapp_dashboard_stats()
returns table(
  messages_today bigint,
  messages_month bigint,
  otp_requests_today bigint,
  successful_otp_verifications bigint,
  failed_otp_verifications bigint,
  failed_messages bigint,
  last_api_error text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    (select count(*) from whatsapp_outbox where created_at >= date_trunc('day', now()) and status = 'sent'),
    (select count(*) from whatsapp_outbox where created_at >= date_trunc('month', now()) and status = 'sent'),
    (select count(*) from whatsapp_otp_challenges where created_at >= date_trunc('day', now())),
    (select count(*) from whatsapp_otp_challenges where verified_at is not null),
    (select coalesce(sum(attempt_count), 0) from whatsapp_otp_challenges),
    (select count(*) from whatsapp_outbox where status = 'failed'),
    (select error_message from whatsapp_outbox where error_message is not null order by created_at desc limit 1);
$$;

create or replace function queue_whatsapp_payment_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
begin
  if new.customer_id is null
     or lower(coalesce(new.payment_method, '')) like 'mpesa_platform_billing%'
     or lower(coalesce(new.payment_method, '')) like '%registration%'
     or lower(coalesce(new.status, '')) not in ('completed', 'paid', 'success') then
    return new;
  end if;
  if tg_op = 'UPDATE' and lower(coalesce(old.status, '')) in ('completed', 'paid', 'success') then
    return new;
  end if;
  if not exists (
    select 1 from isp_customers c
    where c.id = new.customer_id
      and c.phone_verified is true
      and c.phone_e164 is not null
  ) then
    return new;
  end if;

  select coalesce((config->>'enabled')::boolean, false)
      and coalesce((config->'features'->>'paymentNotifications')::boolean, false)
      and coalesce((config->'features'->>'customerNotifications')::boolean, false)
    into v_enabled
  from platform_whatsapp_settings
  where id = 'global_whatsapp';
  if not coalesce(v_enabled, false) then return new; end if;

  insert into whatsapp_outbox(
    id, dedupe_key, event_type, customer_id, admin_id, payload
  ) values (
    gen_random_uuid(),
    'payment:' || new.id::text,
    'payment',
    new.customer_id,
    new.admin_id,
    jsonb_build_object(
      'amount', new.amount,
      'reference', coalesce(nullif(new.mpesa_receipt, ''), new.reference),
      'paid_at', now()
    )
  )
  on conflict (dedupe_key) do nothing;
  return new;
exception when others then
  -- Notification queue failures must never abort a successfully recorded payment.
  raise warning 'WhatsApp payment outbox insert failed: %', sqlstate;
  return new;
end
$$;

drop trigger if exists isp_transactions_whatsapp_payment_notice on isp_transactions;
create trigger isp_transactions_whatsapp_payment_notice
  after insert or update on isp_transactions
  for each row execute function queue_whatsapp_payment_notification();

create or replace function queue_whatsapp_customer_renewal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
begin
  if new.status <> 'active'
     or new.plan_id is null
     or new.expires_at is null
     or new.phone_verified is not true
     or new.phone_e164 is null
     or new.expires_at is not distinct from old.expires_at then
    return new;
  end if;

  select coalesce((config->>'enabled')::boolean, false)
      and coalesce((config->'features'->>'packageNotifications')::boolean, false)
      and coalesce((config->'features'->>'customerNotifications')::boolean, false)
    into v_enabled
  from platform_whatsapp_settings
  where id = 'global_whatsapp';
  if not coalesce(v_enabled, false) then return new; end if;

  insert into whatsapp_outbox(
    id, dedupe_key, event_type, customer_id, admin_id, phone_e164, payload
  ) values (
    gen_random_uuid(),
    'renewal:' || new.id::text || ':' || new.plan_id::text || ':' ||
      extract(epoch from new.expires_at)::bigint::text,
    'renewal',
    new.id,
    new.admin_id,
    null,
    jsonb_build_object(
      'plan_id', new.plan_id,
      'expires_at', new.expires_at,
      'days_remaining', greatest(1, ceil(extract(epoch from (new.expires_at - now())) / 86400)::integer)
    )
  )
  on conflict (dedupe_key) do nothing;
  return new;
exception when others then
  raise warning 'WhatsApp renewal outbox insert failed: %', sqlstate;
  return new;
end
$$;

drop trigger if exists isp_customers_whatsapp_renewal on isp_customers;
create trigger isp_customers_whatsapp_renewal
  after update on isp_customers
  for each row execute function queue_whatsapp_customer_renewal();

create or replace function queue_whatsapp_invoice_notice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_phone text;
  v_phone_verified boolean;
  v_enabled boolean;
  v_event_type text;
begin
  if new.status <> 'paid' or old.status = 'paid' then return new; end if;

  select role, phone_e164, phone_verified
    into v_role, v_phone, v_phone_verified
  from isp_admins
  where id = new.account_id;
  if not found or v_phone_verified is not true or v_phone is null then return new; end if;

  if v_role = 'reseller' then
    select coalesce((config->>'enabled')::boolean, false)
        and coalesce((config->'features'->>'resellerNotifications')::boolean, false)
      into v_enabled
    from platform_whatsapp_settings
    where id = 'global_whatsapp';
    v_event_type := 'reseller_subscription';
  else
    select coalesce((config->>'enabled')::boolean, false)
        and coalesce((config->'features'->>'ispNotifications')::boolean, false)
      into v_enabled
    from platform_whatsapp_settings
    where id = 'global_whatsapp';
    v_event_type := 'isp_subscription';
  end if;
  if not coalesce(v_enabled, false) then return new; end if;

  insert into whatsapp_outbox(
    id, dedupe_key, event_type, customer_id, admin_id, phone_e164, payload
  ) values (
    gen_random_uuid(),
    'subscription-paid:' || new.account_id::text || ':' || new.billing_period::text,
    v_event_type,
    null,
    new.account_id,
    null,
    jsonb_build_object(
      'amount', new.amount_due,
      'billing_period', to_char(new.billing_period, 'YYYY-MM'),
      'status', 'paid',
      'due_date', new.due_date,
      'paid_at', new.paid_at
    )
  )
  on conflict (dedupe_key) do nothing;
  return new;
exception when others then
  raise warning 'WhatsApp subscription outbox insert failed: %', sqlstate;
  return new;
end
$$;

drop trigger if exists platform_billing_invoices_whatsapp_notice on platform_billing_invoices;
create trigger platform_billing_invoices_whatsapp_notice
  after update on platform_billing_invoices
  for each row execute function queue_whatsapp_invoice_notice();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function issue_whatsapp_otp(uuid, text, text, text, bigint, text, text, timestamptz) to service_role;
    grant execute on function verify_whatsapp_otp(uuid, text, integer) to service_role;
    grant execute on function consume_whatsapp_action_token(text, text, text) to service_role;
    grant execute on function claim_whatsapp_outbox(integer, text[]) to service_role;
    grant execute on function complete_whatsapp_outbox(uuid, text, text, text, text, boolean) to service_role;
    grant execute on function record_whatsapp_webhook_message(text, text, text) to service_role;
    grant execute on function enqueue_whatsapp_expiry_notifications() to service_role;
    grant execute on function whatsapp_dashboard_stats() to service_role;
  end if;
end $$;
