-- Renewal vouchers settle the existing monthly platform invoice; they are not
-- customer service vouchers and do not create a separate subscription ledger.
alter table public.platform_billing_invoices
  add column if not exists paid_amount numeric(12,2) not null default 0,
  add column if not exists payment_source text not null default 'unknown',
  add column if not exists voucher_redemption_id bigint;

update public.platform_billing_invoices
set paid_amount = amount_due, payment_source = 'mpesa'
where status = 'paid' and payment_source = 'unknown';

create table if not exists public.admin_renewal_vouchers (
  id bigserial primary key,
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  benefit_type text not null default 'monthly_invoice'
    check (benefit_type = 'monthly_invoice'),
  target_admin_id bigint,
  created_by text not null,
  max_uses integer not null check (max_uses between 1 and 10000),
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text
);

create table if not exists public.admin_renewal_voucher_redemptions (
  id bigserial primary key,
  voucher_id bigint not null references public.admin_renewal_vouchers(id),
  account_id bigint not null,
  billing_invoice_id bigint not null references public.platform_billing_invoices(id),
  actor_admin_id bigint not null,
  renewal_period date not null,
  renewal_applied numeric(12,2) not null,
  redeemed_at timestamptz not null default now(),
  unique (voucher_id, billing_invoice_id),
  unique (billing_invoice_id)
);

alter table public.platform_billing_invoices
  drop constraint if exists platform_billing_invoices_voucher_redemption_fk;
alter table public.platform_billing_invoices
  add constraint platform_billing_invoices_voucher_redemption_fk
  foreign key (voucher_redemption_id)
  references public.admin_renewal_voucher_redemptions(id);

create table if not exists public.admin_renewal_voucher_events (
  id bigserial primary key,
  voucher_id bigint not null references public.admin_renewal_vouchers(id),
  event_type text not null check (event_type in ('created','redeemed','revoked')),
  actor text not null,
  account_id bigint,
  redemption_id bigint references public.admin_renewal_voucher_redemptions(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_renewal_voucher_events_voucher_idx
  on public.admin_renewal_voucher_events(voucher_id, created_at desc);

alter table public.admin_renewal_vouchers enable row level security;
alter table public.admin_renewal_voucher_redemptions enable row level security;
alter table public.admin_renewal_voucher_events enable row level security;
revoke all on public.admin_renewal_vouchers, public.admin_renewal_voucher_redemptions,
  public.admin_renewal_voucher_events from public, anon, authenticated;
grant select, insert, update on public.admin_renewal_vouchers to service_role;
grant select, insert on public.admin_renewal_voucher_redemptions,
  public.admin_renewal_voucher_events to service_role;
grant usage, select on sequence public.admin_renewal_vouchers_id_seq,
  public.admin_renewal_voucher_redemptions_id_seq,
  public.admin_renewal_voucher_events_id_seq to service_role;
grant select, update on public.platform_billing_invoices to service_role;

create or replace function public.create_admin_renewal_voucher(
  p_code_hash text, p_target_admin_id bigint, p_created_by text,
  p_max_uses integer, p_expires_at timestamptz
) returns table(id bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare created_voucher_id bigint;
begin
  if p_code_hash !~ '^[a-f0-9]{64}$' or p_max_uses not between 1 and 10000
     or length(trim(coalesce(p_created_by,''))) = 0 then
    raise exception 'Invalid voucher settings';
  end if;
  if p_target_admin_id is not null and not exists (
    select 1 from isp_admins a where a.id=p_target_admin_id
      and a.is_active is true and a.role in ('isp_admin','reseller')
  ) then raise exception 'Target account is not eligible'; end if;
  insert into admin_renewal_vouchers(code_hash,target_admin_id,created_by,max_uses,expires_at)
    values(lower(p_code_hash),p_target_admin_id,trim(p_created_by),p_max_uses,p_expires_at)
    returning admin_renewal_vouchers.id into created_voucher_id;
  insert into admin_renewal_voucher_events(voucher_id,event_type,actor,account_id,details)
    values(created_voucher_id,'created',trim(p_created_by),p_target_admin_id,
      jsonb_build_object('benefit','monthly_invoice','max_uses',p_max_uses,'expires_at',p_expires_at));
  return query select created_voucher_id;
end $$;

create or replace function public.revoke_admin_renewal_voucher(p_voucher_id bigint,p_actor text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare changed integer;
begin
  update admin_renewal_vouchers set status='revoked',revoked_at=now(),revoked_by=trim(p_actor)
   where id=p_voucher_id and status='active';
  get diagnostics changed=row_count;
  if changed=1 then
    insert into admin_renewal_voucher_events(voucher_id,event_type,actor)
      values(p_voucher_id,'revoked',trim(p_actor));
    return true;
  end if;
  return false;
end $$;

create or replace function public.redeem_admin_renewal_voucher(
  p_code_hash text,p_account_id bigint,p_invoice_id bigint
) returns table(result text,redemption_id bigint,renewal_period date,renewal_applied numeric)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v admin_renewal_vouchers%rowtype; inv platform_billing_invoices%rowtype;
  role_name text; used integer; new_redemption_id bigint;
begin
  select a.role into role_name from isp_admins a
   where a.id=p_account_id and a.is_active is true;
  if role_name is null or role_name not in ('isp_admin','reseller') then
    return query select 'ineligible_account',null::bigint,null::date,null::numeric; return;
  end if;
  select * into inv from platform_billing_invoices i
   where i.id=p_invoice_id and i.account_id=p_account_id for update;
  if not found then return query select 'invoice_unavailable',null::bigint,null::date,null::numeric; return; end if;
  if inv.status='paid' then return query select 'already_paid',null::bigint,inv.billing_period,null::numeric; return; end if;
  if inv.billing_period <> date_trunc('month',now() at time zone 'UTC')::date then
    return query select 'invoice_not_current',null::bigint,inv.billing_period,null::numeric; return;
  end if;
  select * into v from admin_renewal_vouchers x
   where x.code_hash=lower(p_code_hash) for update;
  if not found then return query select 'invalid_code',null::bigint,null::date,null::numeric; return; end if;
  if v.status <> 'active' then return query select 'revoked',null::bigint,null::date,null::numeric; return; end if;
  if v.expires_at is not null and v.expires_at <= now() then
    return query select 'expired',null::bigint,null::date,null::numeric; return;
  end if;
  if v.target_admin_id is not null and v.target_admin_id <> p_account_id then
    return query select 'not_for_account',null::bigint,null::date,null::numeric; return;
  end if;
  select count(*) into used from admin_renewal_voucher_redemptions r where r.voucher_id=v.id;
  if used >= v.max_uses then return query select 'usage_limit',null::bigint,null::date,null::numeric; return; end if;
  if exists(select 1 from admin_renewal_voucher_redemptions r where r.billing_invoice_id=inv.id) then
    return query select 'already_redeemed',null::bigint,inv.billing_period,null::numeric; return;
  end if;
  insert into admin_renewal_voucher_redemptions(voucher_id,account_id,billing_invoice_id,
    actor_admin_id,renewal_period,renewal_applied)
    values(v.id,p_account_id,inv.id,p_account_id,inv.billing_period,inv.amount_due)
    returning id into new_redemption_id;
  update platform_billing_invoices set status='paid',paid_amount=0,payment_source='voucher',
    voucher_redemption_id=new_redemption_id,paid_at=now(),updated_at=now()
   where id=inv.id and account_id=p_account_id and status<>'paid';
  if not found then raise exception 'Invoice status changed during redemption'; end if;
  insert into admin_renewal_voucher_events(voucher_id,event_type,actor,account_id,redemption_id,details)
    values(v.id,'redeemed',p_account_id::text,p_account_id,new_redemption_id,
      jsonb_build_object('billing_invoice_id',inv.id,'billing_period',inv.billing_period,'renewal_applied',inv.amount_due));
  return query select 'redeemed',new_redemption_id,inv.billing_period,inv.amount_due;
end $$;

revoke all on function public.create_admin_renewal_voucher(text,bigint,text,integer,timestamptz) from public,anon,authenticated;
revoke all on function public.revoke_admin_renewal_voucher(bigint,text) from public,anon,authenticated;
revoke all on function public.redeem_admin_renewal_voucher(text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.create_admin_renewal_voucher(text,bigint,text,integer,timestamptz),
  public.revoke_admin_renewal_voucher(bigint,text),
  public.redeem_admin_renewal_voucher(text,bigint,bigint) to service_role;

create or replace function public.record_transaction_revenue()
returns trigger language plpgsql security definer set search_path=public as $$
declare account_id_to_record bigint;
begin
  if new.status not in ('completed','paid','success') then return new; end if;
  if new.payment_method in ('mpesa_platform_billing','platform_billing') then
    update platform_billing_invoices set status='paid',payment_transaction_id=new.id,
      paid_amount=amount_due,payment_source='mpesa',paid_at=coalesce(paid_at,now()),updated_at=now()
     where id=nullif(new.payment_metadata->>'billing_invoice_id','')::bigint
       and account_id=new.admin_id and status in ('due','pending');
    return new;
  end if;
  account_id_to_record:=coalesce(new.reseller_id,new.admin_id);
  if account_id_to_record is null then return new; end if;
  insert into revenue_ledger(revenue_account_id,tenant_id,source_type,source_id,amount,payment_method,occurred_at)
   values(account_id_to_record,new.admin_id,'isp_transaction',new.id,new.amount,new.payment_method,new.created_at)
   on conflict(source_type,source_id) do nothing;
  return new;
end $$;

create or replace function public.get_platform_income_summary()
returns table(registration_today numeric,registration_month numeric,registration_total numeric,
 registration_transactions bigint,renewal_today numeric,renewal_month numeric,renewal_total numeric,
 renewal_transactions bigint)
language sql stable security definer set search_path=public as $$
  with local_clock as (select timezone('Africa/Nairobi',now()) as local_now),
  bounds as (select date_trunc('day',local_now) at time zone 'Africa/Nairobi' day_start,
    (date_trunc('day',local_now)+interval '1 day') at time zone 'Africa/Nairobi' day_end,
    date_trunc('month',local_now) at time zone 'Africa/Nairobi' month_start,
    (date_trunc('month',local_now)+interval '1 month') at time zone 'Africa/Nairobi' month_end from local_clock),
  platform_income as (
    select 'registration'::text income_type,tx.amount,tx.created_at occurred_at
      from isp_transactions tx where tx.payment_method in ('mpesa_registration','manual_registration')
      and tx.status in ('completed','paid','success')
    union all
    select 'renewal'::text,invoice.paid_amount,invoice.paid_at from platform_billing_invoices invoice
      where invoice.status='paid' and invoice.paid_at is not null and invoice.paid_amount>0)
  select coalesce(sum(amount) filter(where income_type='registration' and occurred_at>=day_start and occurred_at<day_end),0),
    coalesce(sum(amount) filter(where income_type='registration' and occurred_at>=month_start and occurred_at<month_end),0),
    coalesce(sum(amount) filter(where income_type='registration'),0),
    count(*) filter(where income_type='registration')::bigint,
    coalesce(sum(amount) filter(where income_type='renewal' and occurred_at>=day_start and occurred_at<day_end),0),
    coalesce(sum(amount) filter(where income_type='renewal' and occurred_at>=month_start and occurred_at<month_end),0),
    coalesce(sum(amount) filter(where income_type='renewal'),0),
    count(*) filter(where income_type='renewal')::bigint
  from platform_income cross join bounds;
$$;
revoke all on function public.get_platform_income_summary() from public,anon,authenticated;
grant execute on function public.get_platform_income_summary() to service_role;
