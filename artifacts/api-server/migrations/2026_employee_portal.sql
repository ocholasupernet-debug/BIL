-- Employee portal and payroll ledger. Additive only; never deletes existing BIL data.
-- This migration is applied by the deployment migration runner, not by the app preview.

create table if not exists public.employee_profiles (
  id uuid primary key default gen_random_uuid(),
  employee_number text not null unique,
  username text not null unique,
  display_name text not null,
  email text,
  phone text,
  subdomain text not null unique,
  status text not null default 'invited'
    check (status in ('invited', 'active', 'suspended', 'terminated')),
  fixed_monthly_salary numeric(14,2) not null default 0 check (fixed_monthly_salary >= 0),
  auth_version integer not null default 1 check (auth_version > 0),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_credentials (
  employee_id uuid primary key references public.employee_profiles(id) on delete restrict,
  password_hash text not null,
  must_change_password boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_invitations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  token_hash text not null unique,
  auth_version integer not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists employee_sessions_active_idx
  on public.employee_sessions(employee_id, expires_at) where revoked_at is null;

create table if not exists public.employee_payout_destinations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  destination_type text not null
    check (destination_type in ('bank', 'mpesa_b2c', 'pochi', 'paybill', 'till')),
  encrypted_details text not null,
  masked_label text not null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'rejected', 'retired')),
  requested_by text not null,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists employee_payout_destinations_employee_idx
  on public.employee_payout_destinations(employee_id, status, created_at desc);
create unique index if not exists employee_payout_destinations_one_pending_idx
  on public.employee_payout_destinations(employee_id) where status = 'pending';

create table if not exists public.employee_commission_rules (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employee_profiles(id) on delete restrict,
  rule_name text not null,
  rate numeric(8,4) not null default 0 check (rate >= 0),
  amount_per_unit numeric(14,2) check (amount_per_unit is null or amount_per_unit >= 0),
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_salary_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  monthly_salary numeric(14,2) not null check (monthly_salary >= 0),
  effective_from date not null,
  effective_to date,
  changed_by text not null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists employee_salary_history_effective_idx
  on public.employee_salary_history(employee_id, effective_from desc);

create table if not exists public.employee_compensation_items (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  component_type text not null
    check (component_type in ('salary', 'commission', 'bonus', 'allowance', 'deduction')),
  amount numeric(14,2) not null check (amount > 0),
  period_start date,
  period_end date,
  description text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'posted', 'rejected', 'reversed')),
  idempotency_key text not null unique,
  approved_by text,
  approved_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_payroll_periods (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'posted', 'cancelled')),
  created_by text not null,
  approved_by text,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(period_start, period_end),
  check (period_end >= period_start)
);

create table if not exists public.employee_payroll_records (
  id uuid primary key default gen_random_uuid(),
  payroll_period_id uuid not null references public.employee_payroll_periods(id) on delete restrict,
  employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  salary numeric(14,2) not null default 0 check (salary >= 0),
  commissions numeric(14,2) not null default 0 check (commissions >= 0),
  bonuses numeric(14,2) not null default 0 check (bonuses >= 0),
  allowances numeric(14,2) not null default 0 check (allowances >= 0),
  deductions numeric(14,2) not null default 0 check (deductions >= 0),
  net_amount numeric(14,2) not null check (net_amount >= 0),
  ledger_reference text unique,
  created_at timestamptz not null default now(),
  unique(payroll_period_id, employee_id)
);

create table if not exists public.employee_financial_ledger (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  entry_type text not null check (entry_type in (
    'salary_credit', 'commission_credit', 'bonus_credit', 'allowance_credit',
    'deduction_debit', 'withdrawal_reserve', 'withdrawal_release',
    'withdrawal_debit', 'reversal'
  )),
  amount numeric(14,2) not null check (amount <> 0),
  currency char(3) not null default 'KES' check (currency = 'KES'),
  reference text not null,
  idempotency_key text not null unique,
  reverses_entry_id bigint references public.employee_financial_ledger(id) on delete restrict,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists employee_financial_ledger_balance_idx
  on public.employee_financial_ledger(employee_id, created_at, id);

create table if not exists public.employee_withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  destination_id uuid not null references public.employee_payout_destinations(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'processing', 'reconciliation_required',
                      'paid', 'rejected', 'cancelled')),
  idempotency_key text not null,
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  paid_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique(employee_id, idempotency_key)
);
create index if not exists employee_withdrawals_employee_idx
  on public.employee_withdrawal_requests(employee_id, created_at desc);
create index if not exists employee_withdrawals_status_idx
  on public.employee_withdrawal_requests(status, created_at);

create table if not exists public.employee_payout_transactions (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null unique references public.employee_withdrawal_requests(id) on delete restrict,
  provider text not null check (provider in ('manual_bank', 'daraja_b2c', 'daraja_b2b', 'b2pochi')),
  originator_reference text not null unique,
  provider_conversation_id text unique,
  status text not null default 'created'
    check (status in ('created', 'submitted', 'succeeded', 'failed', 'uncertain', 'reconciled')),
  provider_receipt text,
  result_code text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.employee_payout_settings (
  id text primary key check (id = 'global'),
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  updated_by text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_payout_controls (
  id text primary key check (id = 'global'),
  enabled boolean not null default false,
  enabled_destination_types text[] not null default '{}',
  max_withdrawal numeric(14,2) not null default 100000 check (max_withdrawal > 0),
  daily_limit numeric(14,2) not null default 100000 check (daily_limit > 0),
  updated_by text not null default 'system',
  updated_at timestamptz not null default now(),
  check (enabled_destination_types <@ array['bank','mpesa_b2c','pochi','paybill','till']::text[])
);
insert into public.employee_payout_controls(id) values ('global') on conflict (id) do nothing;

create table if not exists public.employee_audit_logs (
  id bigint generated always as identity primary key,
  actor_role text not null check (actor_role in ('super_admin', 'payroll_admin', 'employee', 'system')),
  actor_id text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists employee_audit_logs_created_idx
  on public.employee_audit_logs(created_at desc);

create table if not exists public.employee_notifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  notification_type text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.employee_create_invited(
  p_employee_number text,
  p_username text,
  p_display_name text,
  p_email text,
  p_phone text,
  p_subdomain text,
  p_salary numeric,
  p_destination_type text,
  p_destination_ciphertext text,
  p_destination_masked_label text,
  p_invitation_hash text,
  p_invitation_expires_at timestamptz,
  p_actor_id text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_employee_id uuid;
begin
  if p_employee_number !~ '^[A-Z0-9-]{3,32}$'
     or p_username !~ '^[a-z0-9][a-z0-9._-]{2,31}$'
     or p_subdomain !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
     or p_display_name is null or length(trim(p_display_name)) < 2
     or p_salary is null or p_salary < 0 or p_salary <> round(p_salary, 2)
     or p_destination_type not in ('bank', 'mpesa_b2c', 'pochi', 'paybill', 'till')
     or p_destination_ciphertext is null or p_destination_masked_label is null
     or p_invitation_hash is null or p_invitation_expires_at <= now() then
    raise exception 'Employee registration details are invalid.';
  end if;
  insert into public.employee_profiles(
    employee_number, username, display_name, email, phone, subdomain,
    fixed_monthly_salary, created_by
  ) values (
    upper(trim(p_employee_number)), lower(trim(p_username)), trim(p_display_name),
    nullif(trim(p_email), ''), nullif(trim(p_phone), ''), lower(trim(p_subdomain)),
    p_salary, p_actor_id
  ) returning id into v_employee_id;
  insert into public.employee_salary_history(employee_id, monthly_salary, effective_from, changed_by)
    values (v_employee_id, p_salary, current_date, p_actor_id);
  insert into public.employee_invitations(employee_id, token_hash, expires_at, created_by)
    values (v_employee_id, p_invitation_hash, p_invitation_expires_at, p_actor_id);
  insert into public.employee_payout_destinations(
    employee_id, destination_type, encrypted_details, masked_label, status, requested_by, reviewed_by, reviewed_at
  ) values (
    v_employee_id, p_destination_type, p_destination_ciphertext, p_destination_masked_label,
    'active', p_actor_id, p_actor_id, now()
  );
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id)
    values ('super_admin', p_actor_id, 'employee_invited', 'employee', v_employee_id::text);
  return jsonb_build_object('id', v_employee_id, 'employee_number', upper(trim(p_employee_number)),
                            'username', lower(trim(p_username)), 'subdomain', lower(trim(p_subdomain)));
end;
$$;

create or replace function public.employee_activate_invitation(
  p_invitation_hash text,
  p_password_hash text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_invite public.employee_invitations%rowtype;
begin
  select * into v_invite from public.employee_invitations
    where token_hash = p_invitation_hash and used_at is null and expires_at > now()
    for update;
  if not found then raise exception 'This invitation is invalid or expired.'; end if;
  insert into public.employee_credentials(employee_id, password_hash, must_change_password)
    values (v_invite.employee_id, p_password_hash, false);
  update public.employee_profiles set status = 'active', updated_at = now()
    where id = v_invite.employee_id and status = 'invited';
  if not found then raise exception 'This invitation is no longer available.'; end if;
  update public.employee_invitations set used_at = now() where id = v_invite.id;
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id)
    values ('employee', v_invite.employee_id::text, 'employee_activated', 'employee', v_invite.employee_id::text);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.employee_dashboard_snapshot(p_employee_id uuid)
returns jsonb
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select jsonb_build_object(
    'available_balance', coalesce((select sum(amount) from public.employee_financial_ledger
                                    where employee_id = p_employee_id), 0)::text,
    'gross_earnings', coalesce((select sum(amount) from public.employee_financial_ledger
                                 where employee_id = p_employee_id
                                    and entry_type in ('salary_credit','commission_credit','bonus_credit','allowance_credit')), 0)::text,
    'net_earnings', coalesce((select sum(amount) from public.employee_financial_ledger
                               where employee_id = p_employee_id
                                 and entry_type in ('salary_credit','commission_credit','bonus_credit','allowance_credit','deduction_debit')), 0)::text,
    'salary_earned', coalesce((select sum(amount) from public.employee_financial_ledger
                                where employee_id = p_employee_id and entry_type = 'salary_credit'), 0)::text,
    'commissions_earned', coalesce((select sum(amount) from public.employee_financial_ledger
                                     where employee_id = p_employee_id and entry_type = 'commission_credit'), 0)::text,
    'bonuses_earned', coalesce((select sum(amount) from public.employee_financial_ledger
                                 where employee_id = p_employee_id and entry_type = 'bonus_credit'), 0)::text,
    'allowances_earned', coalesce((select sum(amount) from public.employee_financial_ledger
                                    where employee_id = p_employee_id and entry_type = 'allowance_credit'), 0)::text,
    'deductions', coalesce((select sum(-amount) from public.employee_financial_ledger
                             where employee_id = p_employee_id and entry_type = 'deduction_debit'), 0)::text,
    'total_withdrawn', coalesce((select sum(-amount) from public.employee_financial_ledger
                                  where employee_id = p_employee_id and entry_type = 'withdrawal_debit'), 0)::text,
    'withdrawn_today', coalesce((select sum(amount) from public.employee_withdrawal_requests
                                  where employee_id = p_employee_id and status = 'paid'
                                     and paid_at >= date_trunc('day', now())), 0)::text,
    'pending_withdrawals', coalesce((select sum(amount) from public.employee_withdrawal_requests
                                      where employee_id = p_employee_id
                                         and status in ('pending','approved','processing','reconciliation_required')), 0)::text,
    'recent_withdrawals', coalesce((select jsonb_agg(to_jsonb(w) - 'employee_id')
      from (select id, amount::text as amount, status, created_at, paid_at, paid_reference
              from public.employee_withdrawal_requests
             where employee_id = p_employee_id order by created_at desc limit 30) w), '[]'::jsonb),
    'recent_ledger', coalesce((select jsonb_agg(to_jsonb(l) - 'employee_id')
      from (select id, entry_type, amount::text as amount, currency, reference, created_at
              from public.employee_financial_ledger
             where employee_id = p_employee_id order by created_at desc, id desc limit 30) l), '[]'::jsonb)
    ,'payroll_history', coalesce((select jsonb_agg(to_jsonb(p) - 'employee_id')
       from (select id, payroll_period_id, salary::text as salary, commissions::text as commissions,
                    bonuses::text as bonuses, allowances::text as allowances, deductions::text as deductions,
                    net_amount::text as net_amount, created_at
              from public.employee_payroll_records
             where employee_id = p_employee_id order by created_at desc limit 12) p), '[]'::jsonb)
  );
$$;

create or replace function public.employee_admin_summary()
returns jsonb
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select jsonb_build_object(
    'employee_count', (select count(*) from public.employee_profiles where status in ('active','invited')),
    'active_employee_count', (select count(*) from public.employee_profiles where status = 'active'),
    'pending_withdrawal_count', (select count(*) from public.employee_withdrawal_requests
                                  where status in ('pending','approved','processing','reconciliation_required')),
    'total_withdrawn', coalesce((select sum(-amount) from public.employee_financial_ledger
                                  where entry_type = 'withdrawal_debit'), 0)::text,
    'withdrawn_today', coalesce((select sum(amount) from public.employee_withdrawal_requests
                                  where status = 'paid' and paid_at >= date_trunc('day', now())), 0)::text
  );
$$;

create or replace function public.employee_set_salary(
  p_employee_id uuid,
  p_monthly_salary numeric,
  p_effective_from date,
  p_actor_id text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_salary_id uuid;
begin
  if p_monthly_salary is null or p_monthly_salary < 0
     or p_monthly_salary <> round(p_monthly_salary, 2) or p_effective_from is null
     or p_effective_from <> date_trunc('month', p_effective_from)::date then
    raise exception 'Salary details are invalid.';
  end if;
  perform 1 from public.employee_profiles where id = p_employee_id for update;
  if not found then raise exception 'Employee not found.'; end if;
  if exists (select 1 from public.employee_salary_history
      where employee_id = p_employee_id and effective_from >= p_effective_from) then
    raise exception 'Salary changes must start after the current salary history.';
  end if;
  update public.employee_salary_history
     set effective_to = p_effective_from - 1
   where employee_id = p_employee_id and effective_to is null;
  update public.employee_profiles
     set fixed_monthly_salary = p_monthly_salary, updated_at = now()
   where id = p_employee_id;
  insert into public.employee_salary_history(employee_id, monthly_salary, effective_from, changed_by)
    values (p_employee_id, p_monthly_salary, p_effective_from, p_actor_id)
    returning id into v_salary_id;
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
    values ('super_admin', p_actor_id, 'salary_changed', 'employee', p_employee_id::text,
            jsonb_build_object('salary_history_id', v_salary_id, 'effective_from', p_effective_from));
  return jsonb_build_object('id', v_salary_id, 'monthly_salary', p_monthly_salary, 'effective_from', p_effective_from);
end;
$$;

create or replace function public.employee_create_compensation_item(
  p_employee_id uuid,
  p_component_type text,
  p_amount numeric,
  p_period_start date,
  p_period_end date,
  p_description text,
  p_idempotency_key text,
  p_actor_id text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_item_id uuid;
begin
  if p_component_type not in ('commission','bonus','allowance','deduction')
     or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2)
     or p_period_start is null or p_period_end < p_period_start
     or p_description is null or length(trim(p_description)) < 2
     or p_idempotency_key is null or length(p_idempotency_key) < 12 then
    raise exception 'Compensation details are invalid.';
  end if;
  insert into public.employee_compensation_items(
    employee_id, component_type, amount, period_start, period_end, description,
    idempotency_key, created_by
  ) values (
    p_employee_id, p_component_type, p_amount, p_period_start, p_period_end,
    left(trim(p_description), 500), p_idempotency_key, p_actor_id
  ) returning id into v_item_id;
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id)
    values ('super_admin', p_actor_id, 'compensation_created', 'compensation', v_item_id::text);
  return jsonb_build_object('id', v_item_id, 'status', 'pending');
end;
$$;

create or replace function public.employee_create_commission_rule(
  p_employee_id uuid,
  p_rule_name text,
  p_rate numeric,
  p_amount_per_unit numeric,
  p_actor_id text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_rule_id uuid;
begin
  if p_rule_name is null or length(trim(p_rule_name)) < 2
     or p_rate is null or p_rate < 0 or p_rate > 100 or p_rate <> round(p_rate, 4)
     or (p_amount_per_unit is not null and (p_amount_per_unit < 0 or p_amount_per_unit <> round(p_amount_per_unit,2))) then
    raise exception 'Commission rule is invalid.';
  end if;
  insert into public.employee_commission_rules(employee_id, rule_name, rate, amount_per_unit, created_by)
    values (p_employee_id, left(trim(p_rule_name), 120), p_rate, p_amount_per_unit, p_actor_id)
    returning id into v_rule_id;
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id)
    values ('super_admin', p_actor_id, 'commission_rule_created', 'commission_rule', v_rule_id::text);
  return jsonb_build_object('id', v_rule_id, 'active', true);
end;
$$;

create or replace function public.employee_review_compensation_item(
  p_item_id uuid,
  p_actor_id text,
  p_decision text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_item public.employee_compensation_items%rowtype;
begin
  select * into v_item from public.employee_compensation_items where id = p_item_id for update;
  if not found or v_item.status <> 'pending' or p_decision not in ('approve','reject') then
    raise exception 'Compensation item is no longer awaiting review.';
  end if;
  update public.employee_compensation_items
    set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
        approved_by = p_actor_id, approved_at = now()
    where id = p_item_id;
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id)
    values ('super_admin', p_actor_id, 'compensation_' || p_decision, 'compensation', p_item_id::text);
  return jsonb_build_object('id', p_item_id, 'status', case when p_decision='approve' then 'approved' else 'rejected' end);
end;
$$;

create or replace function public.employee_post_payroll(
  p_period_start date,
  p_period_end date,
  p_actor_id text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_period_id uuid;
  v_status text;
  v_employee record;
  v_salary numeric(14,2);
  v_commissions numeric(14,2);
  v_bonuses numeric(14,2);
  v_allowances numeric(14,2);
  v_deductions numeric(14,2);
  v_net numeric(14,2);
  v_count integer := 0;
begin
  if p_period_start is null or p_period_end is null
     or p_period_start <> date_trunc('month', p_period_start)::date
     or p_period_end <> (date_trunc('month', p_period_start) + interval '1 month' - interval '1 day')::date then
    raise exception 'Payroll period is invalid.';
  end if;
  insert into public.employee_payroll_periods(period_start, period_end, status, created_by)
    values (p_period_start, p_period_end, 'draft', p_actor_id)
    on conflict (period_start, period_end) do nothing;
  select id, status into v_period_id, v_status
    from public.employee_payroll_periods
   where period_start = p_period_start and period_end = p_period_end for update;
  if v_status = 'posted' then
    return jsonb_build_object('id', v_period_id, 'status', 'posted', 'record_count',
      (select count(*) from public.employee_payroll_records where payroll_period_id = v_period_id));
  end if;
  for v_employee in
    select id from public.employee_profiles where status = 'active' order by id for update
  loop
    select coalesce((select monthly_salary from public.employee_salary_history
      where employee_id = v_employee.id and effective_from <= p_period_end
        and (effective_to is null or effective_to >= p_period_start)
      order by effective_from desc limit 1),
      (select fixed_monthly_salary from public.employee_profiles where id = v_employee.id), 0)
      into v_salary;
    select
      coalesce(sum(amount) filter (where component_type = 'commission'),0),
      coalesce(sum(amount) filter (where component_type = 'bonus'),0),
      coalesce(sum(amount) filter (where component_type = 'allowance'),0),
      coalesce(sum(amount) filter (where component_type = 'deduction'),0)
      into v_commissions, v_bonuses, v_allowances, v_deductions
      from public.employee_compensation_items
     where employee_id = v_employee.id and status = 'approved'
       and period_start <= p_period_end and period_end >= p_period_start;
    v_net := v_salary + v_commissions + v_bonuses + v_allowances - v_deductions;
    if v_net < 0 then raise exception 'Payroll net cannot be negative.'; end if;
    insert into public.employee_payroll_records(
      payroll_period_id, employee_id, salary, commissions, bonuses, allowances, deductions, net_amount,
      ledger_reference
    ) values (
      v_period_id, v_employee.id, v_salary, v_commissions, v_bonuses, v_allowances, v_deductions, v_net,
      'payroll:' || v_period_id::text || ':' || v_employee.id::text
    ) on conflict (payroll_period_id, employee_id) do nothing;
    insert into public.employee_financial_ledger(employee_id, entry_type, amount, reference, idempotency_key, created_by)
    select v_employee.id, item.entry_type, item.amount, v_period_id::text, item.idempotency_key, p_actor_id
      from (values
        ('salary_credit'::text, v_salary, 'payroll-salary:' || v_period_id::text || ':' || v_employee.id::text),
        ('commission_credit'::text, v_commissions, 'payroll-commission:' || v_period_id::text || ':' || v_employee.id::text),
        ('bonus_credit'::text, v_bonuses, 'payroll-bonus:' || v_period_id::text || ':' || v_employee.id::text),
        ('allowance_credit'::text, v_allowances, 'payroll-allowance:' || v_period_id::text || ':' || v_employee.id::text),
        ('deduction_debit'::text, -v_deductions, 'payroll-deduction:' || v_period_id::text || ':' || v_employee.id::text)
      ) as item(entry_type, amount, idempotency_key)
     where item.amount <> 0
    on conflict (idempotency_key) do nothing;
    update public.employee_compensation_items
       set status = 'posted'
     where employee_id = v_employee.id and status = 'approved'
       and period_start <= p_period_end and period_end >= p_period_start;
    v_count := v_count + 1;
  end loop;
  update public.employee_payroll_periods set status = 'posted', approved_by = p_actor_id, posted_at = now()
    where id = v_period_id;
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
    values ('super_admin', p_actor_id, 'payroll_posted', 'payroll_period', v_period_id::text,
            jsonb_build_object('record_count', v_count));
  return jsonb_build_object('id', v_period_id, 'status', 'posted', 'record_count', v_count);
end;
$$;

create or replace function public.employee_payroll_preview(
  p_period_start date,
  p_period_end date
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_result jsonb;
begin
  if p_period_start is null or p_period_end is null
     or p_period_start <> date_trunc('month', p_period_start)::date
     or p_period_end <> (date_trunc('month', p_period_start) + interval '1 month' - interval '1 day')::date then
    raise exception 'Payroll period is invalid.';
  end if;
  with employee_amounts as (
    select p.id, p.display_name,
      coalesce((select sh.monthly_salary from public.employee_salary_history sh
        where sh.employee_id = p.id and sh.effective_from <= p_period_end
          and (sh.effective_to is null or sh.effective_to >= p_period_start)
        order by sh.effective_from desc limit 1), p.fixed_monthly_salary, 0)::numeric(14,2) as salary,
      coalesce(sum(c.amount) filter (where c.component_type = 'commission'),0)::numeric(14,2) as commissions,
      coalesce(sum(c.amount) filter (where c.component_type = 'bonus'),0)::numeric(14,2) as bonuses,
      coalesce(sum(c.amount) filter (where c.component_type = 'allowance'),0)::numeric(14,2) as allowances,
      coalesce(sum(c.amount) filter (where c.component_type = 'deduction'),0)::numeric(14,2) as deductions
    from public.employee_profiles p
    left join public.employee_compensation_items c
      on c.employee_id = p.id and c.status = 'approved'
       and c.period_start <= p_period_end and c.period_end >= p_period_start
    where p.status = 'active'
    group by p.id
  ), calculated as (
    select *, salary + commissions + bonuses + allowances - deductions as net_amount
      from employee_amounts
  )
  select jsonb_build_object(
    'period_start', p_period_start,
    'period_end', p_period_end,
    'employee_count', count(*),
    'totals', jsonb_build_object(
      'salary', coalesce(sum(salary),0)::text,
      'commissions', coalesce(sum(commissions),0)::text,
      'bonuses', coalesce(sum(bonuses),0)::text,
      'allowances', coalesce(sum(allowances),0)::text,
      'deductions', coalesce(sum(deductions),0)::text,
      'net_amount', coalesce(sum(net_amount),0)::text
    ),
    'employees', coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'display_name', display_name, 'salary', salary::text,
      'commissions', commissions::text, 'bonuses', bonuses::text, 'allowances', allowances::text,
      'deductions', deductions::text, 'net_amount', net_amount::text
    ) order by display_name), '[]'::jsonb)
  ) into v_result from calculated;
  return v_result;
end;
$$;

create or replace function public.employee_reject_ledger_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Employee ledger entries are immutable; post a reversal instead.';
end;
$$;
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'employee_financial_ledger_immutable'
      and tgrelid = 'public.employee_financial_ledger'::regclass
  ) then
    create trigger employee_financial_ledger_immutable
      before update or delete on public.employee_financial_ledger
      for each row execute function public.employee_reject_ledger_mutation();
  end if;
end $$;

create or replace function public.employee_request_withdrawal(
  p_employee_id uuid,
  p_destination_id uuid,
  p_amount numeric,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_existing public.employee_withdrawal_requests%rowtype;
  v_balance numeric(14,2);
  v_daily_total numeric(14,2);
  v_daily_limit numeric(14,2);
  v_max_withdrawal numeric(14,2);
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 1000000
     or p_amount <> round(p_amount, 2)
     or p_idempotency_key is null or length(p_idempotency_key) < 12
     or length(p_idempotency_key) > 128 then
    raise exception 'Invalid withdrawal request.';
  end if;
  perform 1 from public.employee_profiles
    where id = p_employee_id and status = 'active' for update;
  if not found then raise exception 'Employee account is unavailable.'; end if;
  select * into v_existing from public.employee_withdrawal_requests
    where employee_id = p_employee_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'amount', v_existing.amount);
  end if;
  perform 1 from public.employee_payout_destinations
    where id = p_destination_id and employee_id = p_employee_id and status = 'active';
  if not found then raise exception 'An active payout destination is required.'; end if;
  select c.daily_limit, c.max_withdrawal
    into v_daily_limit, v_max_withdrawal
    from public.employee_payout_controls c
    join public.employee_payout_destinations d on d.id = p_destination_id
   where c.id = 'global' and c.enabled = true
     and d.destination_type = any(c.enabled_destination_types);
  if not found then raise exception 'This payout method is not currently enabled.'; end if;
  if p_amount > v_max_withdrawal then raise exception 'Withdrawal exceeds the configured limit.'; end if;
  select coalesce(sum(amount), 0) into v_daily_total
    from public.employee_withdrawal_requests
   where employee_id = p_employee_id and created_at >= date_trunc('day', now())
     and status in ('pending','approved','processing','reconciliation_required','paid');
  if v_daily_total + p_amount > v_daily_limit then raise exception 'Daily withdrawal limit exceeded.'; end if;
  select coalesce(sum(amount), 0) into v_balance
    from public.employee_financial_ledger where employee_id = p_employee_id;
  if v_balance < p_amount then raise exception 'Insufficient available balance.'; end if;
  insert into public.employee_withdrawal_requests(employee_id, destination_id, amount, idempotency_key)
    values (p_employee_id, p_destination_id, p_amount, p_idempotency_key) returning id into v_id;
  insert into public.employee_financial_ledger(
    employee_id, entry_type, amount, reference, idempotency_key, created_by
  ) values (
    p_employee_id, 'withdrawal_reserve', -p_amount, v_id::text,
    'withdrawal-reserve:' || v_id::text, p_employee_id::text
  );
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id)
    values ('employee', p_employee_id::text, 'withdrawal_requested', 'withdrawal', v_id::text);
  return jsonb_build_object('id', v_id, 'status', 'pending', 'amount', p_amount);
end;
$$;

create or replace function public.employee_review_withdrawal(
  p_withdrawal_id uuid,
  p_actor_id text,
  p_decision text,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_request public.employee_withdrawal_requests%rowtype;
begin
  select * into v_request from public.employee_withdrawal_requests
    where id = p_withdrawal_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Withdrawal is no longer awaiting review.';
  end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Invalid review decision.'; end if;
  if p_decision = 'approve' then
    update public.employee_withdrawal_requests
      set status = 'approved', review_note = nullif(left(coalesce(p_note,''), 500), ''),
          reviewed_by = p_actor_id, reviewed_at = now()
      where id = p_withdrawal_id;
  else
    update public.employee_withdrawal_requests
      set status = 'rejected', review_note = nullif(left(coalesce(p_note,''), 500), ''),
          reviewed_by = p_actor_id, reviewed_at = now()
      where id = p_withdrawal_id;
    insert into public.employee_financial_ledger(employee_id, entry_type, amount, reference, idempotency_key, created_by)
      values (v_request.employee_id, 'withdrawal_release', v_request.amount,
              p_withdrawal_id::text, 'withdrawal-release:' || p_withdrawal_id::text, p_actor_id);
  end if;
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id)
    values ('super_admin', p_actor_id, 'withdrawal_' || p_decision, 'withdrawal', p_withdrawal_id::text);
  return jsonb_build_object('id', p_withdrawal_id, 'status', case when p_decision='approve' then 'approved' else 'rejected' end);
end;
$$;

create or replace function public.employee_cancel_withdrawal(
  p_employee_id uuid,
  p_withdrawal_id uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_request public.employee_withdrawal_requests%rowtype;
begin
  perform 1 from public.employee_profiles
    where id = p_employee_id and status = 'active' for update;
  if not found then raise exception 'Employee account is unavailable.'; end if;
  select * into v_request from public.employee_withdrawal_requests
    where id = p_withdrawal_id and employee_id = p_employee_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Only a pending withdrawal can be cancelled.';
  end if;
  update public.employee_withdrawal_requests set status = 'cancelled'
    where id = p_withdrawal_id;
  insert into public.employee_financial_ledger(employee_id, entry_type, amount, reference, idempotency_key, created_by)
    values (p_employee_id, 'withdrawal_release', v_request.amount, p_withdrawal_id::text,
            'withdrawal-release:' || p_withdrawal_id::text, p_employee_id::text);
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id)
    values ('employee', p_employee_id::text, 'withdrawal_cancelled', 'withdrawal', p_withdrawal_id::text);
  return jsonb_build_object('id', p_withdrawal_id, 'status', 'cancelled');
end;
$$;

create or replace function public.employee_review_payout_destination(
  p_destination_id uuid,
  p_actor_id text,
  p_decision text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_destination public.employee_payout_destinations%rowtype;
begin
  select * into v_destination from public.employee_payout_destinations
    where id = p_destination_id for update;
  if not found or v_destination.status <> 'pending'
     or p_decision not in ('approve','reject') then
    raise exception 'Destination change is no longer awaiting review.';
  end if;
  if p_decision = 'approve' then
    update public.employee_payout_destinations
       set status = 'retired', reviewed_by = p_actor_id, reviewed_at = now()
     where employee_id = v_destination.employee_id and status = 'active';
    update public.employee_payout_destinations
       set status = 'active', reviewed_by = p_actor_id, reviewed_at = now()
     where id = p_destination_id;
  else
    update public.employee_payout_destinations
       set status = 'rejected', reviewed_by = p_actor_id, reviewed_at = now()
     where id = p_destination_id;
  end if;
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id)
    values ('super_admin', p_actor_id, 'payout_destination_' || p_decision, 'payout_destination', p_destination_id::text);
  return jsonb_build_object('id', p_destination_id, 'status', case when p_decision='approve' then 'active' else 'rejected' end);
end;
$$;

create or replace function public.employee_record_confirmed_payout(
  p_withdrawal_id uuid,
  p_actor_id text,
  p_payment_reference text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_request public.employee_withdrawal_requests%rowtype;
  v_destination_type text;
begin
  if p_payment_reference is null or length(trim(p_payment_reference)) < 3
     or length(p_payment_reference) > 128 then
    raise exception 'A valid payment reference is required.';
  end if;
  select * into v_request from public.employee_withdrawal_requests
    where id = p_withdrawal_id for update;
  if not found or v_request.status not in ('approved', 'reconciliation_required') then
    raise exception 'Only an approved payout can be recorded.';
  end if;
  select destination_type into v_destination_type
    from public.employee_payout_destinations where id = v_request.destination_id;
  if v_destination_type <> 'bank' then
    raise exception 'Manual payment recording is limited to confirmed bank transfers.';
  end if;
  update public.employee_withdrawal_requests
    set status = 'paid', paid_reference = left(trim(p_payment_reference),128), paid_at = now()
    where id = p_withdrawal_id;
  insert into public.employee_financial_ledger(employee_id, entry_type, amount, reference, idempotency_key, created_by)
    values
      (v_request.employee_id, 'withdrawal_release', v_request.amount,
       p_withdrawal_id::text, 'withdrawal-release:' || p_withdrawal_id::text, p_actor_id),
      (v_request.employee_id, 'withdrawal_debit', -v_request.amount,
       p_withdrawal_id::text, 'withdrawal-debit:' || p_withdrawal_id::text, p_actor_id);
  insert into public.employee_payout_transactions(
    withdrawal_id, provider, originator_reference, status, provider_receipt, updated_at
  ) values (
    p_withdrawal_id, 'manual_bank', 'manual:' || p_withdrawal_id::text, 'succeeded',
    left(trim(p_payment_reference), 128), now()
  ) on conflict (withdrawal_id) do nothing;
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id)
    values ('super_admin', p_actor_id, 'withdrawal_confirmed_paid', 'withdrawal', p_withdrawal_id::text);
  return jsonb_build_object('id', p_withdrawal_id, 'status', 'paid');
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'employee_profiles','employee_credentials','employee_invitations','employee_sessions',
    'employee_payout_destinations','employee_commission_rules','employee_compensation_items',
    'employee_salary_history','employee_payroll_periods','employee_payroll_records','employee_financial_ledger',
    'employee_withdrawal_requests','employee_payout_transactions','employee_payout_settings',
    'employee_payout_controls',
    'employee_audit_logs','employee_notifications'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant all on table public.%I to service_role', t);
    end if;
  end loop;
end $$;

revoke all on function public.employee_request_withdrawal(uuid, uuid, numeric, text) from public;
revoke all on function public.employee_review_withdrawal(uuid, text, text, text) from public;
revoke all on function public.employee_cancel_withdrawal(uuid, uuid) from public;
revoke all on function public.employee_review_payout_destination(uuid, text, text) from public;
revoke all on function public.employee_record_confirmed_payout(uuid, text, text) from public;
revoke all on function public.employee_create_invited(text, text, text, text, text, text, numeric, text, text, text, text, timestamptz, text) from public;
revoke all on function public.employee_activate_invitation(text, text) from public;
revoke all on function public.employee_dashboard_snapshot(uuid) from public;
revoke all on function public.employee_admin_summary() from public;
revoke all on function public.employee_set_salary(uuid, numeric, date, text) from public;
revoke all on function public.employee_create_compensation_item(uuid, text, numeric, date, date, text, text, text) from public;
revoke all on function public.employee_create_commission_rule(uuid, text, numeric, numeric, text) from public;
revoke all on function public.employee_review_compensation_item(uuid, text, text) from public;
revoke all on function public.employee_post_payroll(date, date, text) from public;
revoke all on function public.employee_payroll_preview(date, date) from public;
do $$
declare
  fn regprocedure;
  api_role text;
begin
  -- Supabase may grant new functions directly to its browser-facing roles
  -- through default privileges. Revoking PUBLIC alone does not remove those
  -- grants. Keep the RPC boundary on the API's service role.
  foreach fn in array array[
    'public.employee_request_withdrawal(uuid, uuid, numeric, text)'::regprocedure,
    'public.employee_review_withdrawal(uuid, text, text, text)'::regprocedure,
    'public.employee_cancel_withdrawal(uuid, uuid)'::regprocedure,
    'public.employee_review_payout_destination(uuid, text, text)'::regprocedure,
    'public.employee_record_confirmed_payout(uuid, text, text)'::regprocedure,
    'public.employee_create_invited(text, text, text, text, text, text, numeric, text, text, text, text, timestamptz, text)'::regprocedure,
    'public.employee_activate_invitation(text, text)'::regprocedure,
    'public.employee_dashboard_snapshot(uuid)'::regprocedure,
    'public.employee_admin_summary()'::regprocedure,
    'public.employee_set_salary(uuid, numeric, date, text)'::regprocedure,
    'public.employee_create_compensation_item(uuid, text, numeric, date, date, text, text, text)'::regprocedure,
    'public.employee_create_commission_rule(uuid, text, numeric, numeric, text)'::regprocedure,
    'public.employee_review_compensation_item(uuid, text, text)'::regprocedure,
    'public.employee_post_payroll(date, date, text)'::regprocedure,
    'public.employee_payroll_preview(date, date)'::regprocedure
  ] loop
    foreach api_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = api_role) then
        execute format('revoke all on function %s from %I', fn, api_role);
      end if;
    end loop;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.employee_request_withdrawal(uuid, uuid, numeric, text) to service_role;
    grant execute on function public.employee_review_withdrawal(uuid, text, text, text) to service_role;
    grant execute on function public.employee_cancel_withdrawal(uuid, uuid) to service_role;
    grant execute on function public.employee_review_payout_destination(uuid, text, text) to service_role;
    grant execute on function public.employee_record_confirmed_payout(uuid, text, text) to service_role;
    grant execute on function public.employee_create_invited(text, text, text, text, text, text, numeric, text, text, text, text, timestamptz, text) to service_role;
    grant execute on function public.employee_activate_invitation(text, text) to service_role;
    grant execute on function public.employee_dashboard_snapshot(uuid) to service_role;
    grant execute on function public.employee_admin_summary() to service_role;
    grant execute on function public.employee_set_salary(uuid, numeric, date, text) to service_role;
    grant execute on function public.employee_create_compensation_item(uuid, text, numeric, date, date, text, text, text) to service_role;
    grant execute on function public.employee_create_commission_rule(uuid, text, numeric, numeric, text) to service_role;
    grant execute on function public.employee_review_compensation_item(uuid, text, text) to service_role;
    grant execute on function public.employee_post_payroll(date, date, text) to service_role;
    grant execute on function public.employee_payroll_preview(date, date) to service_role;
  end if;
end $$;
