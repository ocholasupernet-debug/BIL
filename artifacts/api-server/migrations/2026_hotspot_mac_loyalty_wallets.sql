-- Loyalty belongs to the device that used the Hotspot, never to the payer's
-- phone number. Leave old phone wallets intact unless their ledger history
-- maps exactly to one or more transaction MACs and reconciles exactly.
create table if not exists public.isp_loyalty_device_accounts (
  admin_id bigint not null references public.isp_admins(id) on delete cascade,
  device_mac text not null check (device_mac ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  phone text,
  points_balance bigint not null default 0 check (points_balance >= 0),
  fractional_balance numeric(3,2) not null default 0 check (fractional_balance >= 0 and fractional_balance < 1),
  updated_at timestamptz not null default now(),
  primary key (admin_id, device_mac)
);

create table if not exists public.isp_loyalty_device_ledger (
  id bigserial primary key,
  admin_id bigint not null references public.isp_admins(id) on delete cascade,
  device_mac text not null check (device_mac ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  transaction_id bigint not null references public.isp_transactions(id) on delete restrict,
  plan_id bigint not null references public.isp_plans(id) on delete restrict,
  entry_type text not null check (entry_type in ('purchase_award','plan_redemption')),
  source_reference text not null,
  points_delta numeric(14,2) not null check (points_delta <> 0),
  created_at timestamptz not null default now(),
  unique (admin_id, source_reference)
);

-- Backfill only where the old phone wallet's complete whole-point balance is
-- exactly explained by transaction ledger entries and the device mapping is
-- unambiguous. The old rows remain untouched for review in every case.
with mac_totals as (
  select l.admin_id, l.phone,
         upper(regexp_replace(t.mac_address, '[^0-9A-F]', '', 'gi')) as compact_mac,
         sum(l.points_delta) as net_points,
         count(*) filter (where l.entry_type='purchase_award') as awards,
         max(l.created_at) as last_activity
    from public.isp_loyalty_ledger l
    join public.isp_transactions t on t.id=l.transaction_id
   where coalesce(t.mac_address,'') ~* '^[0-9A-F:-]{12,17}$'
   group by l.admin_id,l.phone,upper(regexp_replace(t.mac_address, '[^0-9A-F]', '', 'gi'))
), valid_wallets as (
  select a.admin_id,a.phone,a.points_balance,a.fractional_balance,
         count(m.compact_mac) as mac_count,
         sum(greatest(m.net_points,0)) as mapped_points
    from public.isp_loyalty_accounts a
    left join mac_totals m on m.admin_id=a.admin_id and m.phone=a.phone
   group by a.admin_id,a.phone,a.points_balance,a.fractional_balance
  having coalesce(sum(m.net_points),0)=a.points_balance+a.fractional_balance
     and coalesce(bool_and(m.net_points>=0 and m.compact_mac ~ '^[0-9A-F]{12}$'),true)
), safe_rows as (
  select m.*
    from mac_totals m
    join valid_wallets v on v.admin_id=m.admin_id and v.phone=m.phone
   where m.net_points >= 0 and m.compact_mac ~ '^[0-9A-F]{12}$'
     and not exists (
       select 1 from mac_totals other
        where other.admin_id=m.admin_id and other.compact_mac=m.compact_mac and other.phone<>m.phone
     )
)
insert into public.isp_loyalty_device_accounts
  (admin_id,device_mac,phone,points_balance,fractional_balance,updated_at)
select admin_id,
       regexp_replace(compact_mac,'([0-9A-F]{2})(?=[0-9A-F])','\1:','g'),
       phone,floor(net_points)::bigint,(net_points-floor(net_points))::numeric(3,2),last_activity
  from safe_rows
on conflict (admin_id,device_mac) do nothing;

create index if not exists isp_loyalty_device_ledger_account_idx
  on public.isp_loyalty_device_ledger(admin_id,device_mac,created_at desc);

create or replace function public.award_hotspot_loyalty_device_points(p_transaction_id bigint)
returns table(points_awarded numeric,points_balance numeric)
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  tx public.isp_transactions%rowtype;
  plan public.isp_plans%rowtype;
  cust public.isp_customers%rowtype;
  mac text;
  award numeric(14,2):=0;
  old_award numeric(14,2);
  balance bigint:=0;
  fraction numeric(3,2):=0;
  total numeric(16,2);
  whole bigint;
  inserted_id bigint;
  ratio numeric(12,2):=0;
  plan_award numeric(14,2);
begin
  select * into tx from public.isp_transactions where id=p_transaction_id for update;
  if not found or tx.status not in ('completed','paid','success')
     or lower(coalesce(tx.payment_method,'')) not like 'mpesa%'
     or tx.plan_id is null or tx.customer_id is null then
    return query select 0::numeric,0::numeric; return;
  end if;
  select * into plan from public.isp_plans where id=tx.plan_id and admin_id=tx.admin_id;
  if not found or lower(coalesce(plan.type,''))<>'hotspot' then
    return query select 0::numeric,0::numeric; return;
  end if;
  mac:=regexp_replace(upper(coalesce(tx.mac_address,'')),'[^0-9A-F]','','g');
  if length(mac)<>12 or mac !~ '^[0-9A-F]{12}$' then return query select 0::numeric,0::numeric; return; end if;
  select * into cust from public.isp_customers
   where id=tx.customer_id and admin_id=coalesce(plan.owner_reseller_id,tx.admin_id)
     and type='hotspot' and plan_id=tx.plan_id;
  if not found or regexp_replace(upper(coalesce(cust.mac_address,'')),'[^0-9A-F]','','g')<>mac then
    return query select 0::numeric,0::numeric; return;
  end if;
  -- This transaction may have been awarded before MAC wallets were installed.
  -- Never award it a second time: its old balance is migrated only when its
  -- complete ledger reconciles exactly to a uniquely attributable device.
  select l.points_delta into old_award from public.isp_loyalty_ledger l
   where l.admin_id=tx.admin_id and l.source_reference='purchase:'||tx.id::text
     and l.entry_type='purchase_award';
  if found then
    select a.points_balance,a.fractional_balance into balance,fraction
      from public.isp_loyalty_device_accounts a where a.admin_id=tx.admin_id
       and a.device_mac=regexp_replace(mac,'([0-9A-F]{2})(?=[0-9A-F])','\1:','g');
    return query select coalesce(old_award,0),
      coalesce(balance,0)::numeric+coalesce(fraction,0);
    return;
  end if;
  select l.points_delta into old_award from public.isp_loyalty_device_ledger l
   where l.admin_id=tx.admin_id and l.source_reference='purchase:'||tx.id::text;
  if found then
    select a.points_balance,a.fractional_balance into balance,fraction
      from public.isp_loyalty_device_accounts a where a.admin_id=tx.admin_id
       and a.device_mac=regexp_replace(mac,'([0-9A-F]{2})(?=[0-9A-F])','\1:','g');
    return query select coalesce(old_award,0),coalesce(balance,0)::numeric+coalesce(fraction,0); return;
  end if;
  select kes_per_point into ratio from public.isp_loyalty_settings where admin_id=tx.admin_id;
  select points_awarded into plan_award from public.isp_loyalty_plan_rules
   where admin_id=tx.admin_id and plan_id=tx.plan_id;
  if found and plan_award is not null then award:=plan_award;
  elsif coalesce(ratio,0)>0 then award:=least(round(greatest(tx.amount,0)/ratio,2),2147483647);
  end if;
  if award<=0 then
    select points_balance,fractional_balance into balance,fraction from public.isp_loyalty_device_accounts
     where admin_id=tx.admin_id and device_mac=regexp_replace(mac,'([0-9A-F]{2})(?=[0-9A-F])','\1:','g');
    return query select 0::numeric,coalesce(balance,0)::numeric+coalesce(fraction,0); return;
  end if;
  insert into public.isp_loyalty_device_accounts(admin_id,device_mac,phone)
   values(tx.admin_id,regexp_replace(mac,'([0-9A-F]{2})(?=[0-9A-F])','\1:','g'),tx.payment_phone)
   on conflict(admin_id,device_mac) do nothing;
  select points_balance,fractional_balance into balance,fraction from public.isp_loyalty_device_accounts
   where admin_id=tx.admin_id and device_mac=regexp_replace(mac,'([0-9A-F]{2})(?=[0-9A-F])','\1:','g') for update;
  insert into public.isp_loyalty_device_ledger(admin_id,device_mac,transaction_id,plan_id,entry_type,source_reference,points_delta)
   values(tx.admin_id,regexp_replace(mac,'([0-9A-F]{2})(?=[0-9A-F])','\1:','g'),tx.id,tx.plan_id,'purchase_award','purchase:'||tx.id::text,award)
   on conflict(admin_id,source_reference) do nothing returning id into inserted_id;
  if inserted_id is not null then
    total:=coalesce(fraction,0)+award; whole:=floor(total)::bigint;
    fraction:=(total-whole)::numeric(3,2);
    update public.isp_loyalty_device_accounts set points_balance=points_balance+whole,
      fractional_balance=fraction,phone=tx.payment_phone,updated_at=now()
     where admin_id=tx.admin_id and device_mac=regexp_replace(mac,'([0-9A-F]{2})(?=[0-9A-F])','\1:','g')
     returning points_balance into balance;
  end if;
  return query select award,coalesce(balance,0)::numeric+coalesce(fraction,0);
end $$;

revoke all on function public.award_hotspot_loyalty_device_points(bigint) from public;
grant execute on function public.award_hotspot_loyalty_device_points(bigint) to service_role;

create or replace function public.redeem_hotspot_loyalty_device_points(
  p_admin_id bigint,p_plan_id bigint,p_phone text,p_mac_address text,p_idempotency_key text
) returns table(checkout_id text,points_balance bigint,points_spent integer)
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  plan public.isp_plans%rowtype;
  mac text;
  device text;
  phone text;
  required_points integer;
  reference text;
  account_balance bigint;
  tx public.isp_transactions%rowtype;
  spent integer;
  new_tx bigint;
begin
  mac:=regexp_replace(upper(coalesce(p_mac_address,'')),'[^0-9A-F]','','g');
  device:=regexp_replace(mac,'([0-9A-F]{2})(?=[0-9A-F])','\1:','g');
  phone:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  if p_admin_id is null or p_admin_id<1 or p_plan_id is null or p_plan_id<1
     or length(mac)<>12 or mac !~ '^[0-9A-F]{12}$'
     or coalesce(p_idempotency_key,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'A valid Hotspot plan, device, and redemption request are required.';
  end if;
  select * into plan from public.isp_plans where id=p_plan_id and admin_id=p_admin_id;
  if not found or lower(coalesce(plan.type,''))<>'hotspot' or plan.is_active is not true
     or plan.client_can_purchase is not true or plan.router_id is null then
    raise exception 'This Hotspot plan cannot currently be purchased with points.';
  end if;
  select redemption_points into required_points from public.isp_loyalty_plan_rules
   where admin_id=p_admin_id and plan_id=p_plan_id;
  if required_points is null then required_points:=ceil(plan.price)::integer; end if;
  if required_points<=0 then raise exception 'This plan is not enabled for loyalty redemption.'; end if;
  if not exists(select 1 from public.isp_customers c
    where c.admin_id in (coalesce(plan.owner_reseller_id,p_admin_id),p_admin_id)
      and c.type='hotspot' and regexp_replace(upper(coalesce(c.mac_address,'')),'[^0-9A-F]','','g')=mac
      and c.router_id=plan.router_id and c.port_id is not distinct from plan.port_id) then
    raise exception 'This device is not linked to a Hotspot account in this service.';
  end if;
  reference:='LOYALTY-'||lower(p_idempotency_key);
  select * into tx from public.isp_transactions t where t.admin_id=p_admin_id
   and t.reference=reference and t.payment_method='loyalty_points';
  if found then
    if tx.plan_id is distinct from p_plan_id
       or regexp_replace(upper(coalesce(tx.mac_address,'')),'[^0-9A-F]','','g')<>mac then
      raise exception 'This redemption request ID has already been used for a different purchase.';
    end if;
    select points_balance into account_balance from public.isp_loyalty_device_accounts
     where admin_id=p_admin_id and device_mac=device;
    select abs(points_delta)::integer into spent from public.isp_loyalty_device_ledger
     where admin_id=p_admin_id and transaction_id=tx.id and entry_type='plan_redemption';
    return query select reference,coalesce(account_balance,0),coalesce(spent,required_points); return;
  end if;
  insert into public.isp_loyalty_device_accounts(admin_id,device_mac,phone)
   values(p_admin_id,device,case when phone ~ '^254[17][0-9]{8}$' then phone else null end)
   on conflict(admin_id,device_mac) do nothing;
  select points_balance into account_balance from public.isp_loyalty_device_accounts
   where admin_id=p_admin_id and device_mac=device for update;
  select * into tx from public.isp_transactions t where t.admin_id=p_admin_id
   and t.reference=reference and t.payment_method='loyalty_points';
  if found then
    if tx.plan_id is distinct from p_plan_id
       or regexp_replace(upper(coalesce(tx.mac_address,'')),'[^0-9A-F]','','g')<>mac then
      raise exception 'This redemption request ID has already been used for a different purchase.';
    end if;
    select abs(points_delta)::integer into spent from public.isp_loyalty_device_ledger
     where admin_id=p_admin_id and transaction_id=tx.id and entry_type='plan_redemption';
    return query select reference,coalesce(account_balance,0),coalesce(spent,required_points); return;
  end if;
  if account_balance<required_points then raise exception 'There are not enough loyalty points for this package.'; end if;
  insert into public.isp_transactions(admin_id,plan_id,amount,payment_method,payment_phone,mac_address,reference,status,notes)
   values(p_admin_id,p_plan_id,0,'loyalty_points',case when phone ~ '^254[17][0-9]{8}$' then phone else null end,
     device,reference,'completed',format('Hotspot package redeemed with %s loyalty points.',required_points))
   on conflict do nothing returning id into new_tx;
  if new_tx is null then
    select * into tx from public.isp_transactions t where t.admin_id=p_admin_id
     and t.reference=reference and t.payment_method='loyalty_points';
    if not found or tx.plan_id is distinct from p_plan_id
       or regexp_replace(upper(coalesce(tx.mac_address,'')),'[^0-9A-F]','','g')<>mac then
      raise exception 'This redemption request could not be safely retried.';
    end if;
    select abs(points_delta)::integer into spent from public.isp_loyalty_device_ledger
     where admin_id=p_admin_id and transaction_id=tx.id and entry_type='plan_redemption';
    select points_balance into account_balance from public.isp_loyalty_device_accounts
     where admin_id=p_admin_id and device_mac=device;
    return query select reference,coalesce(account_balance,0),coalesce(spent,required_points); return;
  end if;
  insert into public.isp_loyalty_device_ledger(admin_id,device_mac,transaction_id,plan_id,entry_type,source_reference,points_delta)
   values(p_admin_id,device,new_tx,p_plan_id,'plan_redemption','redemption:'||lower(p_idempotency_key),-required_points);
  update public.isp_loyalty_device_accounts set points_balance=points_balance-required_points,updated_at=now()
   where admin_id=p_admin_id and device_mac=device returning points_balance into account_balance;
  return query select reference,account_balance,required_points;
end $$;
revoke all on function public.redeem_hotspot_loyalty_device_points(bigint,bigint,text,text,text) from public;
grant execute on function public.redeem_hotspot_loyalty_device_points(bigint,bigint,text,text,text) to service_role;
notify pgrst,'reload schema';
