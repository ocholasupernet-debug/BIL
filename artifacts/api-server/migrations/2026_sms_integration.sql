create table if not exists platform_sms_settings(id text primary key check(id='global_sms'),config jsonb not null default '{}',api_key_encrypted text,updated_at timestamptz not null default now());
create table if not exists sms_otp_challenges(like whatsapp_otp_challenges including all);
create table if not exists sms_action_tokens(like whatsapp_action_tokens including all);
create table if not exists sms_outbox(like whatsapp_outbox including all);
alter table sms_otp_challenges drop constraint if exists whatsapp_otp_challenges_purpose_check;
alter table sms_action_tokens drop constraint if exists whatsapp_action_tokens_purpose_check;
alter table sms_otp_challenges drop constraint if exists sms_otp_purpose;
alter table sms_action_tokens drop constraint if exists sms_action_purpose;
alter table sms_otp_challenges add constraint sms_otp_purpose check(purpose in ('login','registration','recovery'));
alter table sms_action_tokens add constraint sms_action_purpose check(purpose in ('registration','recovery'));
alter table platform_sms_settings enable row level security;
alter table sms_otp_challenges enable row level security;
alter table sms_action_tokens enable row level security;
alter table sms_outbox enable row level security;
create or replace function issue_sms_otp(
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
  if p_purpose is null
     or p_purpose not in ('login', 'registration', 'recovery')
     or p_phone_e164 is null
     or p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
     or p_otp_hash is null
     or p_otp_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at is null
     or p_expires_at <= now()
     or p_expires_at > now() + interval '15 minutes' then
    return query select 'invalid'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_phone_e164 || ':' || p_purpose, 0)
  );

  select count(*), max(created_at)
    into v_phone_count, v_last_request
  from sms_otp_challenges
  where phone_e164 = p_phone_e164
    and purpose = p_purpose
    and created_at > now() - interval '1 hour';

  if v_phone_count >= 5
     or (v_last_request is not null
         and v_last_request > now() - interval '60 seconds') then
    return query select 'limited'::text;
    return;
  end if;

  if coalesce(p_ip_hash, '') <> '' then
    select count(*) into v_ip_count
    from sms_otp_challenges
    where request_ip_hash = p_ip_hash
      and created_at > now() - interval '1 hour';
    if v_ip_count >= 20 then
      return query select 'limited'::text;
      return;
    end if;
  end if;

  update sms_otp_challenges
    set invalidated_at = now()
  where phone_e164 = p_phone_e164
    and purpose = p_purpose
    and consumed_at is null
    and invalidated_at is null;

  insert into sms_otp_challenges(
    id, phone_e164, purpose, account_type, account_id, otp_hash,
    request_ip_hash, expires_at
  ) values (
    p_id, p_phone_e164, p_purpose, p_account_type, p_account_id, p_otp_hash,
    coalesce(p_ip_hash, ''), p_expires_at
  );
  return query select 'issued'::text;
end
$$;
create or replace function verify_sms_otp(
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
  v_challenge sms_otp_challenges%rowtype;
  v_max_attempts integer := greatest(1, least(coalesce(p_max_attempts, 5), 10));
begin
  select * into v_challenge
  from sms_otp_challenges
  where id = p_id
  for update;

  if not found
     or v_challenge.consumed_at is not null
     or v_challenge.invalidated_at is not null then
    return query select
      'invalid'::text, null::text, null::text, null::bigint, null::text;
    return;
  end if;

  if v_challenge.expires_at <= now() then
    update sms_otp_challenges set consumed_at = now() where id = p_id;
    return query select
      'invalid'::text, null::text, null::text, null::bigint, null::text;
    return;
  end if;

  if v_challenge.attempt_count >= v_max_attempts then
    update sms_otp_challenges set consumed_at = now() where id = p_id;
    return query select
      'invalid'::text, null::text, null::text, null::bigint, null::text;
    return;
  end if;

  if p_otp_hash is null
     or p_otp_hash !~ '^[0-9a-f]{64}$'
     or v_challenge.otp_hash <> p_otp_hash then
    update sms_otp_challenges
      set attempt_count = attempt_count + 1,
          consumed_at = case
            when attempt_count + 1 >= v_max_attempts then now()
            else null
          end
    where id = p_id;
    return query select
      'invalid'::text, null::text, null::text, null::bigint, null::text;
    return;
  end if;

  update sms_otp_challenges
    set consumed_at = now(), verified_at = now()
  where id = p_id;

  return query select
    'verified'::text,
    v_challenge.purpose,
    v_challenge.account_type,
    v_challenge.account_id,
    v_challenge.phone_e164;
end
$$;
create or replace function consume_sms_action_token(p_token_hash text,p_phone_e164 text,p_purpose text) returns table(consumed boolean,account_type text,account_id bigint) language plpgsql security definer set search_path=public,pg_temp as $$ declare x sms_action_tokens%rowtype;begin select * into x from sms_action_tokens where token_hash=p_token_hash and (p_phone_e164='' or phone_e164=p_phone_e164) and purpose=p_purpose and consumed_at is null and expires_at>now() for update;if not found then return query select false,null::text,null::bigint;return;end if;update sms_action_tokens set consumed_at=now() where token_hash=p_token_hash;return query select true,x.account_type,x.account_id;end $$;
drop function if exists sms_dashboard_stats();
create function sms_dashboard_stats()
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
    (select count(*) from sms_outbox
      where status = 'sent' and created_at >= date_trunc('day', now())),
    (select count(*) from sms_outbox
      where status = 'sent' and created_at >= date_trunc('month', now())),
    (select count(*) from sms_otp_challenges
      where created_at >= date_trunc('day', now())),
    (select count(*) from sms_otp_challenges where verified_at is not null),
    (select coalesce(sum(attempt_count), 0) from sms_otp_challenges),
    (select count(*) from sms_outbox where status = 'failed'),
    (select error_message from sms_outbox
      where error_message is not null
      order by created_at desc
      limit 1)
$$;
create or replace function queue_sms_payment_notification() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.customer_id is null or lower(coalesce(new.status,'')) not in('paid','completed','success') or not exists(select 1 from isp_customers where id=new.customer_id and phone_verified is true and phone_e164 is not null) then return new; end if;
 if not exists(select 1 from platform_sms_settings where id='global_sms' and coalesce((config->>'enabled')::boolean,false) and coalesce((config->'features'->>'paymentNotifications')::boolean,false) and coalesce((config->'features'->>'customerNotifications')::boolean,false)) then return new; end if;
 insert into sms_outbox(id,dedupe_key,event_type,customer_id,admin_id,payload) values(gen_random_uuid(),'payment:'||new.id,'payment',new.customer_id,new.admin_id,jsonb_build_object('amount',new.amount,'reference',new.reference,'paid_at',now())) on conflict(dedupe_key) do nothing; return new;
exception when others then raise warning 'SMS payment outbox insert failed: %',sqlstate; return new; end $$;
drop trigger if exists isp_transactions_sms_payment_notice on isp_transactions;
create trigger isp_transactions_sms_payment_notice after insert or update on isp_transactions for each row execute function queue_sms_payment_notification();
create or replace function claim_sms_outbox(p_limit integer default 10,p_event_types text[] default null) returns table(id uuid,dedupe_key text,event_type text,customer_id bigint,admin_id bigint,phone_e164 text,payload jsonb,attempts integer) language sql security definer set search_path=public,pg_temp as $$
 with due as(select q.id from sms_outbox q where ((q.status='queued' and q.available_at<=now()) or(q.status='sending' and q.locked_at<now()-interval '5 minutes')) and q.created_at>=now()-interval '48 hours' and(p_event_types is null or q.event_type=any(p_event_types)) and q.attempts<8 order by q.available_at,q.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,10),50))) update sms_outbox q set status='sending',locked_at=now(),attempts=q.attempts+1 from due where q.id=due.id returning q.id,q.dedupe_key,q.event_type,q.customer_id,q.admin_id,q.phone_e164,q.payload,q.attempts $$;
create or replace function complete_sms_outbox(p_id uuid,p_status text,p_message_id text,p_error_code text,p_error_message text,p_retryable boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare n integer;begin select attempts into n from sms_outbox where id=p_id for update;update sms_outbox set status=case when p_status='sent' then 'sent' when p_retryable and n<8 then 'queued' else 'failed' end,provider_message_id=coalesce(p_message_id,provider_message_id),error_code=case when p_status='sent' then null else left(p_error_code,40) end,error_message=case when p_status='sent' then null else left(p_error_message,200) end,available_at=case when p_retryable and n<8 then now()+make_interval(secs=>least(3600,15*power(2,greatest(n-1,0))::integer)) else available_at end,locked_at=null,sent_at=case when p_status='sent' then now() else sent_at end where id=p_id;end$$;
create or replace function enqueue_sms_expiry_notifications() returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer; m integer := 0;
begin
 insert into sms_outbox(id,dedupe_key,event_type,customer_id,admin_id,payload)
 select gen_random_uuid(),'expiry:'||c.id||':'||to_char(c.expires_at at time zone 'UTC','YYYYMMDDHH24MI'),'expiry',c.id,c.admin_id,jsonb_build_object('expires_at',c.expires_at)
 from isp_customers c where c.status='active' and c.phone_verified is true and c.phone_e164 is not null and c.expires_at>now() and c.expires_at<=now()+interval '48 hours'
 and exists(select 1 from platform_sms_settings where id='global_sms' and coalesce((config->>'enabled')::boolean,false) and coalesce((config->'features'->>'packageNotifications')::boolean,false) and coalesce((config->'features'->>'customerNotifications')::boolean,false))
 on conflict(dedupe_key) do nothing;
 get diagnostics n=row_count;
 insert into sms_outbox(id,dedupe_key,event_type,admin_id,payload)
 select gen_random_uuid(),'platform-invoice-reminder:'||i.id,
   case when a.role='reseller' then 'reseller_subscription' else 'isp_subscription' end,a.id,
   jsonb_build_object('amount',i.amount_due,'billing_period',to_char(i.billing_period,'YYYY-MM'),'status','due','due_date',i.due_date)
 from platform_billing_invoices i join isp_admins a on a.id=i.account_id
 where i.status in ('due','pending') and i.due_date between current_date-3 and current_date+3
 and a.phone_verified is true and a.phone_e164 is not null
 and exists(select 1 from platform_sms_settings s where s.id='global_sms' and coalesce((s.config->>'enabled')::boolean,false)
   and coalesce((s.config->'features'->>(case when a.role='reseller' then 'resellerNotifications' else 'ispNotifications' end))::boolean,false))
 on conflict(dedupe_key) do nothing;
 get diagnostics m=row_count;
 return coalesce(n,0)+coalesce(m,0);
end $$;
create or replace function queue_sms_customer_renewal() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$begin if new.status='active' and new.phone_verified is true and new.phone_e164 is not null and new.expires_at is distinct from old.expires_at and exists(select 1 from platform_sms_settings where id='global_sms' and coalesce((config->>'enabled')::boolean,false) and coalesce((config->'features'->>'packageNotifications')::boolean,false) and coalesce((config->'features'->>'customerNotifications')::boolean,false)) then insert into sms_outbox(id,dedupe_key,event_type,customer_id,admin_id,payload) values(gen_random_uuid(),'renewal:'||new.id||':'||extract(epoch from new.expires_at),'renewal',new.id,new.admin_id,jsonb_build_object('expires_at',new.expires_at)) on conflict(dedupe_key) do nothing;end if;return new;exception when others then raise warning 'SMS renewal outbox insert failed: %',sqlstate;return new;end$$;
drop trigger if exists isp_customers_sms_renewal on isp_customers;
create trigger isp_customers_sms_renewal after update on isp_customers for each row execute function queue_sms_customer_renewal();
create or replace function queue_sms_invoice_notice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_enabled boolean;
  v_event_type text;
begin
  if new.status <> 'paid' or old.status = 'paid' then
    return new;
  end if;

  select role
    into v_role
  from isp_admins
  where id = new.account_id;

  if v_role is null then
    return new;
  end if;

  v_event_type := case
    when v_role = 'reseller' then 'reseller_subscription'
    else 'isp_subscription'
  end;

  select
    a.phone_verified is true
    and a.phone_e164 is not null
    and coalesce((s.config->>'enabled')::boolean, false)
    and coalesce(
      (s.config->'features'->>(
        case when a.role = 'reseller'
          then 'resellerNotifications'
          else 'ispNotifications'
        end
      ))::boolean,
      false
    )
    into v_enabled
  from isp_admins a
  join platform_sms_settings s on s.id = 'global_sms'
  where a.id = new.account_id;

  if coalesce(v_enabled, false) then
    insert into sms_outbox(
      id, dedupe_key, event_type, admin_id, payload
    ) values (
      gen_random_uuid(),
      'subscription-paid:' || new.account_id || ':' || new.billing_period,
      v_event_type,
      new.account_id,
      jsonb_build_object(
        'amount', new.amount_due,
        'billing_period', to_char(new.billing_period, 'YYYY-MM'),
        'status', 'paid',
        'due_date', new.due_date,
        'paid_at', new.paid_at
      )
    )
    on conflict (dedupe_key) do nothing;
  end if;

  return new;
exception when others then
  raise warning 'SMS invoice outbox insert failed: %', sqlstate;
  return new;
end
$$;
drop trigger if exists platform_billing_invoices_sms_notice on platform_billing_invoices;
create trigger platform_billing_invoices_sms_notice after update on platform_billing_invoices for each row execute function queue_sms_invoice_notice();

revoke all on function issue_sms_otp(uuid, text, text, text, bigint, text, text, timestamptz) from public;
revoke all on function verify_sms_otp(uuid, text, integer) from public;
revoke all on function consume_sms_action_token(text, text, text) from public;
revoke all on function sms_dashboard_stats() from public;
revoke all on function claim_sms_outbox(integer, text[]) from public;
revoke all on function complete_sms_outbox(uuid, text, text, text, text, boolean) from public;
revoke all on function enqueue_sms_expiry_notifications() from public;
revoke all on function queue_sms_payment_notification() from public;
revoke all on function queue_sms_customer_renewal() from public;
revoke all on function queue_sms_invoice_notice() from public;
revoke all on table platform_sms_settings from public;
revoke all on table sms_otp_challenges from public;
revoke all on table sms_action_tokens from public;
revoke all on table sms_outbox from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table platform_sms_settings from anon';
    execute 'revoke all on table sms_otp_challenges from anon';
    execute 'revoke all on table sms_action_tokens from anon';
    execute 'revoke all on table sms_outbox from anon';
    execute 'revoke all on function issue_sms_otp(uuid, text, text, text, bigint, text, text, timestamptz) from anon';
    execute 'revoke all on function verify_sms_otp(uuid, text, integer) from anon';
    execute 'revoke all on function consume_sms_action_token(text, text, text) from anon';
    execute 'revoke all on function sms_dashboard_stats() from anon';
    execute 'revoke all on function claim_sms_outbox(integer, text[]) from anon';
    execute 'revoke all on function complete_sms_outbox(uuid, text, text, text, text, boolean) from anon';
    execute 'revoke all on function enqueue_sms_expiry_notifications() from anon';
    execute 'revoke all on function queue_sms_payment_notification() from anon';
    execute 'revoke all on function queue_sms_customer_renewal() from anon';
    execute 'revoke all on function queue_sms_invoice_notice() from anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table platform_sms_settings from authenticated';
    execute 'revoke all on table sms_otp_challenges from authenticated';
    execute 'revoke all on table sms_action_tokens from authenticated';
    execute 'revoke all on table sms_outbox from authenticated';
    execute 'revoke all on function issue_sms_otp(uuid, text, text, text, bigint, text, text, timestamptz) from authenticated';
    execute 'revoke all on function verify_sms_otp(uuid, text, integer) from authenticated';
    execute 'revoke all on function consume_sms_action_token(text, text, text) from authenticated';
    execute 'revoke all on function sms_dashboard_stats() from authenticated';
    execute 'revoke all on function claim_sms_outbox(integer, text[]) from authenticated';
    execute 'revoke all on function complete_sms_outbox(uuid, text, text, text, text, boolean) from authenticated';
    execute 'revoke all on function enqueue_sms_expiry_notifications() from authenticated';
    execute 'revoke all on function queue_sms_payment_notification() from authenticated';
    execute 'revoke all on function queue_sms_customer_renewal() from authenticated';
    execute 'revoke all on function queue_sms_invoice_notice() from authenticated';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table platform_sms_settings to service_role;
    grant select, insert, update, delete on table sms_otp_challenges to service_role;
    grant select, insert, update, delete on table sms_action_tokens to service_role;
    grant select, insert, update, delete on table sms_outbox to service_role;
    grant execute on function issue_sms_otp(uuid, text, text, text, bigint, text, text, timestamptz) to service_role;
    grant execute on function verify_sms_otp(uuid, text, integer) to service_role;
    grant execute on function consume_sms_action_token(text, text, text) to service_role;
    grant execute on function sms_dashboard_stats() to service_role;
    grant execute on function claim_sms_outbox(integer, text[]) to service_role;
    grant execute on function complete_sms_outbox(uuid, text, text, text, text, boolean) to service_role;
    grant execute on function enqueue_sms_expiry_notifications() to service_role;
    grant execute on function queue_sms_payment_notification() to service_role;
    grant execute on function queue_sms_customer_renewal() to service_role;
    grant execute on function queue_sms_invoice_notice() to service_role;
  end if;
end
$$;