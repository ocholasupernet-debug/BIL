-- Immutable revenue accounting and recurring ISP/reseller platform billing.
-- This migration deliberately does not cascade-delete ledger or invoice rows
-- when mutable customer, transaction, or account records are removed.

create table if not exists public.platform_billing_config (
  id integer primary key check (id = 1),
  cutoff_day integer not null default 25 check (cutoff_day between 1 and 28),
  due_day integer not null default 5 check (due_day between 1 and 28),
  sales_threshold numeric(12,2) not null default 8000 check (sales_threshold >= 0),
  low_sales_fee numeric(12,2) not null default 500 check (low_sales_fee >= 0),
  high_sales_fee numeric(12,2) not null default 1400 check (high_sales_fee >= 0),
  updated_at timestamptz not null default now()
);

insert into public.platform_billing_config (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.revenue_ledger (
  id bigserial primary key,
  revenue_account_id bigint not null,
  tenant_id bigint,
  source_type text not null check (source_type in ('isp_transaction', 'reseller_sale')),
  source_id bigint not null,
  amount numeric(12,2) not null check (amount >= 0),
  payment_method text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create index if not exists revenue_ledger_account_period_idx
  on public.revenue_ledger(revenue_account_id, occurred_at);
create index if not exists revenue_ledger_tenant_period_idx
  on public.revenue_ledger(tenant_id, occurred_at);

create or replace function public.reject_revenue_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Revenue ledger is append-only';
end;
$$;

drop trigger if exists revenue_ledger_no_update on public.revenue_ledger;
create trigger revenue_ledger_no_update
before update or delete on public.revenue_ledger
for each row execute function public.reject_revenue_ledger_mutation();

create table if not exists public.platform_billing_invoices (
  id bigserial primary key,
  account_id bigint not null,
  tenant_id bigint,
  billing_period date not null,
  sales_period_start date not null,
  sales_period_end date not null,
  sales_total numeric(12,2) not null default 0,
  sales_threshold numeric(12,2) not null,
  low_sales_fee numeric(12,2) not null,
  high_sales_fee numeric(12,2) not null,
  amount_due numeric(12,2) not null,
  due_date date not null,
  status text not null default 'due'
    check (status in ('due', 'pending', 'paid', 'expired')),
  payment_phone text,
  payment_transaction_id bigint,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, billing_period)
);

create index if not exists platform_billing_invoices_account_idx
  on public.platform_billing_invoices(account_id, billing_period desc);

-- A transaction can be completed in one insert or by a later settlement.
create or replace function public.record_transaction_revenue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account_id_to_record bigint;
begin
  if new.status not in ('completed', 'paid', 'success') then
    return new;
  end if;
  if new.payment_method in ('mpesa_platform_billing', 'platform_billing') then
    update public.platform_billing_invoices
       set status = 'paid',
           payment_transaction_id = new.id,
           paid_at = coalesce(paid_at, now()),
           updated_at = now()
     where id = nullif(new.payment_metadata ->> 'billing_invoice_id', '')::bigint
       and account_id = new.admin_id
       and status in ('due', 'pending');
    return new;
  end if;
  account_id_to_record := coalesce(new.reseller_id, new.admin_id);
  if account_id_to_record is null then
    return new;
  end if;

  insert into public.revenue_ledger (
    revenue_account_id, tenant_id, source_type, source_id, amount,
    payment_method, occurred_at
  )
  values (
    account_id_to_record, new.admin_id, 'isp_transaction', new.id, new.amount,
    new.payment_method, new.created_at
  )
  on conflict (source_type, source_id) do nothing;

  return new;
end;
$$;

drop trigger if exists isp_transactions_revenue_ledger on public.isp_transactions;
create trigger isp_transactions_revenue_ledger
after insert or update of status on public.isp_transactions
for each row execute function public.record_transaction_revenue();

create or replace function public.record_reseller_sale_revenue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'completed' then
    return new;
  end if;

  insert into public.revenue_ledger (
    revenue_account_id, tenant_id, source_type, source_id, amount,
    payment_method, occurred_at
  )
  values (
    new.reseller_id, new.admin_id, 'reseller_sale', new.id, new.amount,
    new.gateway_type, new.created_at
  )
  on conflict (source_type, source_id) do nothing;
  return new;
end;
$$;

drop trigger if exists isp_reseller_sales_revenue_ledger on public.isp_reseller_sales;
create trigger isp_reseller_sales_revenue_ledger
after insert or update of status on public.isp_reseller_sales
for each row execute function public.record_reseller_sale_revenue();

-- Backfill existing completed records exactly once.
insert into public.revenue_ledger (
  revenue_account_id, tenant_id, source_type, source_id, amount,
  payment_method, occurred_at
)
select coalesce(t.reseller_id, t.admin_id), t.admin_id, 'isp_transaction',
       t.id, t.amount, t.payment_method, t.created_at
from public.isp_transactions t
where t.status in ('completed', 'paid', 'success')
  and t.payment_method not in ('mpesa_platform_billing', 'platform_billing')
on conflict (source_type, source_id) do nothing;

insert into public.revenue_ledger (
  revenue_account_id, tenant_id, source_type, source_id, amount,
  payment_method, occurred_at
)
select s.reseller_id, s.admin_id, 'reseller_sale', s.id, s.amount,
       s.gateway_type, s.created_at
from public.isp_reseller_sales s
where s.status = 'completed'
on conflict (source_type, source_id) do nothing;

alter table public.platform_billing_config enable row level security;
alter table public.revenue_ledger enable row level security;
alter table public.platform_billing_invoices enable row level security;
revoke all on table public.platform_billing_config from anon, authenticated;
revoke all on table public.revenue_ledger from anon, authenticated;
revoke all on table public.platform_billing_invoices from anon, authenticated;
grant select, insert, update on table public.platform_billing_config to service_role;
grant select, insert on table public.revenue_ledger to service_role;
grant select, insert, update on table public.platform_billing_invoices to service_role;
grant usage, select on sequence public.revenue_ledger_id_seq to service_role;
grant usage, select on sequence public.platform_billing_invoices_id_seq to service_role;

create or replace function public.get_revenue_summary(p_account_id bigint)
returns table (
  income_today numeric,
  income_month numeric,
  total_revenue numeric,
  total_transactions bigint
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(case when occurred_at::date = current_date then amount else 0 end), 0),
    coalesce(sum(case when date_trunc('month', occurred_at) = date_trunc('month', now()) then amount else 0 end), 0),
    coalesce(sum(amount), 0),
    count(*)::bigint
  from public.revenue_ledger
  where revenue_account_id = p_account_id;
$$;