-- Add audited administrator credits and single-use Staff award codes.
-- This migration is additive; posted ledger entries remain immutable.

alter table public.employee_financial_ledger
  drop constraint if exists employee_financial_ledger_entry_type_check;

alter table public.employee_financial_ledger
  add constraint employee_financial_ledger_entry_type_check
  check (entry_type in (
    'salary_credit', 'commission_credit', 'bonus_credit', 'allowance_credit',
    'admin_credit', 'deduction_debit', 'withdrawal_reserve',
    'withdrawal_release', 'withdrawal_debit', 'reversal'
  ));

create table if not exists public.employee_admin_credits (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (length(trim(reason)) between 2 and 500),
  idempotency_key text not null unique,
  ledger_entry_id bigint not null unique
    references public.employee_financial_ledger(id) on delete restrict,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists employee_admin_credits_employee_idx
  on public.employee_admin_credits(employee_id, created_at desc);

create table if not exists public.employee_award_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (length(trim(reason)) between 2 and 500),
  idempotency_key text not null unique,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references public.employee_profiles(id) on delete restrict,
  redemption_ledger_id bigint unique
    references public.employee_financial_ledger(id) on delete restrict,
  revoked_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  check (
    (redeemed_at is null and redeemed_by is null and redemption_ledger_id is null)
    or
    (redeemed_at is not null and redeemed_by is not null and redemption_ledger_id is not null)
  )
);
create index if not exists employee_award_codes_employee_idx
  on public.employee_award_codes(employee_id, created_at desc);

create or replace function public.employee_admin_post_credit(
  p_employee_id uuid,
  p_amount numeric,
  p_reason text,
  p_idempotency_key text,
  p_actor_id text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_credit_id uuid := gen_random_uuid();
  v_ledger_id bigint;
  v_existing_employee uuid;
  v_ledger_key text;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 999999999999.99
     or p_amount <> round(p_amount, 2)
     or p_reason is null or length(trim(p_reason)) < 2 or length(trim(p_reason)) > 500
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{12,128}$'
     or p_actor_id is null or length(trim(p_actor_id)) < 1 then
    raise exception 'Staff credit details are invalid.';
  end if;

  perform 1 from public.employee_profiles
    where id = p_employee_id and status = 'active' and account_type = 'employee'
    for update;
  if not found then raise exception 'Active employee account was not found.'; end if;

  v_ledger_key := 'admin-credit:' || p_idempotency_key;
  insert into public.employee_financial_ledger(
    employee_id, entry_type, amount, reference, idempotency_key, created_by
  ) values (
    p_employee_id, 'admin_credit', p_amount, 'admin_credit:' || v_credit_id::text,
    v_ledger_key, p_actor_id
  )
  on conflict (idempotency_key) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    select employee_id into v_existing_employee
      from public.employee_financial_ledger where idempotency_key = v_ledger_key;
    insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
      values ('super_admin', p_actor_id, 'admin_credit_duplicate_rejected', 'employee_credit',
              case when v_existing_employee = p_employee_id then p_employee_id::text else null end,
              jsonb_build_object('reason', 'idempotency_key_reused'));
    return jsonb_build_object('status', 'duplicate');
  end if;

  insert into public.employee_admin_credits(
    id, employee_id, amount, reason, idempotency_key, ledger_entry_id, created_by
  ) values (
    v_credit_id, p_employee_id, p_amount, left(trim(p_reason), 500),
    p_idempotency_key, v_ledger_id, p_actor_id
  );
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
    values ('super_admin', p_actor_id, 'admin_credit_posted', 'employee_credit', v_credit_id::text,
            jsonb_build_object('employee_id', p_employee_id, 'amount', p_amount::text,
                               'reason', left(trim(p_reason), 500), 'ledger_entry_id', v_ledger_id));
  return jsonb_build_object(
    'status', 'posted', 'credit_id', v_credit_id, 'ledger_entry_id', v_ledger_id,
    'amount', p_amount::text
  );
end;
$$;

create or replace function public.employee_issue_award_code(
  p_employee_id uuid,
  p_amount numeric,
  p_reason text,
  p_code_hash text,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_actor_id text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_award_id uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 999999999999.99
     or p_amount <> round(p_amount, 2)
     or p_reason is null or length(trim(p_reason)) < 2 or length(trim(p_reason)) > 500
     or p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$'
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{12,128}$'
     or p_expires_at is null or p_expires_at <= now()
     or p_expires_at > now() + interval '90 days'
     or p_actor_id is null or length(trim(p_actor_id)) < 1 then
    raise exception 'Award code details are invalid.';
  end if;

  perform 1 from public.employee_profiles
    where id = p_employee_id and status = 'active' and account_type = 'employee'
    for update;
  if not found then raise exception 'Active employee account was not found.'; end if;

  insert into public.employee_award_codes(
    code_hash, employee_id, amount, reason, idempotency_key, expires_at, created_by
  ) values (
    p_code_hash, p_employee_id, p_amount, left(trim(p_reason), 500),
    p_idempotency_key, p_expires_at, p_actor_id
  )
  on conflict do nothing
  returning id into v_award_id;

  if v_award_id is null then
    insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, details)
      values ('super_admin', p_actor_id, 'award_code_issue_duplicate_rejected', 'award_code',
              jsonb_build_object('reason', 'idempotency_or_code_conflict'));
    return jsonb_build_object('status', 'duplicate');
  end if;

  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
    values ('super_admin', p_actor_id, 'award_code_issued', 'award_code', v_award_id::text,
            jsonb_build_object('employee_id', p_employee_id, 'amount', p_amount::text,
                               'reason', left(trim(p_reason), 500), 'expires_at', p_expires_at));
  return jsonb_build_object('status', 'issued', 'award_id', v_award_id, 'expires_at', p_expires_at);
end;
$$;

create or replace function public.employee_redeem_award_code(
  p_employee_id uuid,
  p_code_hash text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_award public.employee_award_codes%rowtype;
  v_ledger_id bigint;
  v_rejection text;
begin
  if p_employee_id is null then raise exception 'Staff sign-in is required.'; end if;
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then
    insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, details)
      values ('employee', p_employee_id::text, 'award_code_redeem_rejected', 'award_code',
              jsonb_build_object('reason', 'invalid_code'));
    return jsonb_build_object('status', 'rejected');
  end if;

  select * into v_award from public.employee_award_codes
    where code_hash = p_code_hash for update;
  if not found then
    insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, details)
      values ('employee', p_employee_id::text, 'award_code_redeem_rejected', 'award_code',
              jsonb_build_object('reason', 'invalid_code'));
    return jsonb_build_object('status', 'rejected');
  end if;

  if v_award.employee_id <> p_employee_id then
    v_rejection := 'recipient_mismatch';
  elsif v_award.redeemed_at is not null then
    v_rejection := 'already_redeemed';
  elsif v_award.revoked_at is not null then
    v_rejection := 'revoked';
  elsif v_award.expires_at <= now() then
    v_rejection := 'expired';
  else
    perform 1 from public.employee_profiles
      where id = p_employee_id and status = 'active' and account_type = 'employee'
      for update;
    if not found then v_rejection := 'account_unavailable'; end if;
  end if;

  if v_rejection is not null then
    insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
      values ('employee', p_employee_id::text, 'award_code_redeem_rejected', 'award_code',
              v_award.id::text, jsonb_build_object('reason', v_rejection));
    return jsonb_build_object('status', 'rejected');
  end if;

  insert into public.employee_financial_ledger(
    employee_id, entry_type, amount, reference, idempotency_key, created_by
  ) values (
    p_employee_id, 'admin_credit', v_award.amount, 'award_code:' || v_award.id::text,
    'award-code-redeem:' || v_award.id::text, p_employee_id::text
  )
  on conflict (idempotency_key) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
      values ('employee', p_employee_id::text, 'award_code_redeem_rejected', 'award_code',
              v_award.id::text, jsonb_build_object('reason', 'replay_or_duplicate'));
    return jsonb_build_object('status', 'rejected');
  end if;

  update public.employee_award_codes
     set redeemed_at = now(), redeemed_by = p_employee_id, redemption_ledger_id = v_ledger_id
   where id = v_award.id and redeemed_at is null and revoked_at is null;
  if not found then raise exception 'Award code redemption changed concurrently.'; end if;

  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
    values ('employee', p_employee_id::text, 'award_code_redeemed', 'award_code', v_award.id::text,
            jsonb_build_object('amount', v_award.amount::text, 'ledger_entry_id', v_ledger_id));
  return jsonb_build_object('status', 'redeemed', 'amount', v_award.amount::text, 'ledger_entry_id', v_ledger_id);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['employee_admin_credits', 'employee_award_codes'] loop
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

revoke all on function public.employee_admin_post_credit(uuid, numeric, text, text, text) from public;
revoke all on function public.employee_issue_award_code(uuid, numeric, text, text, text, timestamptz, text) from public;
revoke all on function public.employee_redeem_award_code(uuid, text) from public;

do $$
declare
  fn regprocedure;
  api_role text;
begin
  foreach fn in array array[
    'public.employee_admin_post_credit(uuid, numeric, text, text, text)'::regprocedure,
    'public.employee_issue_award_code(uuid, numeric, text, text, text, timestamptz, text)'::regprocedure,
    'public.employee_redeem_award_code(uuid, text)'::regprocedure
  ] loop
    foreach api_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = api_role) then
        execute format('revoke all on function %s from %I', fn, api_role);
      end if;
    end loop;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.employee_admin_post_credit(uuid, numeric, text, text, text) to service_role;
    grant execute on function public.employee_issue_award_code(uuid, numeric, text, text, text, timestamptz, text) to service_role;
    grant execute on function public.employee_redeem_award_code(uuid, text) to service_role;
  end if;
end $$;
