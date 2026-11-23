-- Separate Daraja B2B Paybill/Till payouts plus audited manual Pochi recording.
-- Additive only. Automation is disabled unless an administrator and server enable it.
alter table public.employee_payout_controls
  add column if not exists automatic_b2b_enabled boolean not null default false,
  add column if not exists b2b_environment text not null default 'sandbox'
    check (b2b_environment in ('sandbox', 'production'));

alter table public.employee_payout_transactions
  add column if not exists callback_token_hash text,
  add column if not exists expected_amount numeric(14,2),
  add column if not exists expected_destination_hash text,
  add column if not exists provider_command text,
  add column if not exists callback_received_at timestamptz,
  add column if not exists failure_category text;

create unique index if not exists employee_daraja_b2b_receipt_unique_idx
  on public.employee_payout_transactions(provider_receipt)
  where provider = 'daraja_b2b' and provider_receipt is not null;

create unique index if not exists employee_manual_pochi_receipt_unique_idx
  on public.employee_payout_transactions(provider_receipt)
  where provider = 'b2pochi' and provider_receipt is not null;

create or replace function public.employee_review_withdrawal_and_claim_daraja_b2b(
  p_withdrawal_id uuid,
  p_actor_id text,
  p_note text,
  p_destination_type text,
  p_command text,
  p_originator_reference text,
  p_callback_token_hash text,
  p_expected_destination_hash text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_request public.employee_withdrawal_requests%rowtype;
  v_destination public.employee_payout_destinations%rowtype;
  v_enabled boolean;
  v_requests_enabled boolean;
  v_enabled_types text[];
begin
  if p_actor_id is null or p_actor_id <> 'super_admin'
     or p_destination_type not in ('paybill', 'till')
     or (p_destination_type = 'paybill' and p_command <> 'BusinessPayBill')
     or (p_destination_type = 'till' and p_command <> 'BusinessBuyGoods')
     or p_originator_reference is null or p_originator_reference !~ '^[A-Za-z0-9_-]{12,64}$'
     or p_callback_token_hash is null or p_callback_token_hash !~ '^[0-9a-f]{64}$'
     or p_expected_destination_hash is null or p_expected_destination_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid B2B payout review metadata.';
  end if;

  select * into v_request from public.employee_withdrawal_requests
    where id = p_withdrawal_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'Withdrawal is no longer awaiting review.';
  end if;
  if v_request.amount <> trunc(v_request.amount) then
    raise exception 'Daraja B2B supports whole-KES withdrawal amounts only.';
  end if;

  select * into v_destination from public.employee_payout_destinations
    where id = v_request.destination_id and employee_id = v_request.employee_id
      and status = 'active' for update;
  if not found or v_destination.destination_type <> p_destination_type then
    raise exception 'An active registered merchant destination is required.';
  end if;

  select automatic_b2b_enabled, enabled, enabled_destination_types
    into v_enabled, v_requests_enabled, v_enabled_types
    from public.employee_payout_controls where id = 'global' for update;
  if not found or v_enabled is distinct from true or v_requests_enabled is distinct from true
     or not (p_destination_type = any(coalesce(v_enabled_types, '{}'::text[]))) then
    raise exception 'Automatic B2B payouts are disabled.';
  end if;

  update public.employee_withdrawal_requests
    set status = 'processing', review_note = nullif(left(coalesce(p_note,''), 500), ''),
        reviewed_by = p_actor_id, reviewed_at = now()
    where id = p_withdrawal_id;
  insert into public.employee_payout_transactions(
    withdrawal_id, provider, originator_reference, status, callback_token_hash,
    expected_amount, expected_destination_hash, provider_command, updated_at
  ) values (
    p_withdrawal_id, 'daraja_b2b', p_originator_reference, 'created',
    p_callback_token_hash, v_request.amount, p_expected_destination_hash, p_command, now()
  );
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
    values ('super_admin', p_actor_id, 'withdrawal_approved_for_daraja_b2b',
            'withdrawal', p_withdrawal_id::text,
            jsonb_build_object('provider', 'daraja_b2b', 'destination_type', p_destination_type, 'command', p_command));
  return jsonb_build_object(
    'id', p_withdrawal_id, 'status', 'processing', 'amount', v_request.amount,
    'destination_id', v_request.destination_id, 'originator_reference', p_originator_reference
  );
end;
$$;

create or replace function public.employee_mark_daraja_b2b_submitted(
  p_withdrawal_id uuid,
  p_originator_reference text,
  p_conversation_id text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_transaction public.employee_payout_transactions%rowtype;
begin
  select * into v_transaction from public.employee_payout_transactions
    where withdrawal_id = p_withdrawal_id and provider = 'daraja_b2b' for update;
  if not found or v_transaction.originator_reference <> p_originator_reference then
    raise exception 'B2B payout transaction reference does not match.';
  end if;
  if v_transaction.status in ('succeeded','failed','reconciled') then
    return jsonb_build_object('status', v_transaction.status);
  end if;
  if v_transaction.status = 'uncertain' then
    return jsonb_build_object('status', 'reconciliation_required');
  end if;
  if v_transaction.status = 'submitted' then
    if v_transaction.provider_conversation_id = p_conversation_id then
      return jsonb_build_object('status', 'submitted');
    end if;
    raise exception 'B2B conversation reference does not match.';
  end if;
  if v_transaction.status <> 'created'
     or p_conversation_id is null or length(trim(p_conversation_id)) = 0
     or length(p_conversation_id) > 128 then
    raise exception 'B2B payout transaction is not ready for submission.';
  end if;
  update public.employee_payout_transactions set
    provider_conversation_id = p_conversation_id, status = 'submitted',
    updated_at = now(), failure_category = null
    where id = v_transaction.id;
  return jsonb_build_object('status', 'submitted');
end;
$$;

create or replace function public.employee_mark_daraja_b2b_uncertain(
  p_withdrawal_id uuid,
  p_originator_reference text,
  p_callback_token_hash text,
  p_failure_category text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_transaction public.employee_payout_transactions%rowtype;
begin
  select * into v_transaction from public.employee_payout_transactions
    where withdrawal_id = p_withdrawal_id and provider = 'daraja_b2b' for update;
  if not found or p_originator_reference is null
     or v_transaction.originator_reference <> p_originator_reference
     or p_callback_token_hash is null
     or v_transaction.callback_token_hash is distinct from p_callback_token_hash then
    raise exception 'B2B payout transaction reference does not match.';
  end if;
  if v_transaction.status = 'succeeded' then
    return jsonb_build_object('status', 'succeeded');
  end if;
  if v_transaction.status in ('failed','reconciled','uncertain') then
    return jsonb_build_object('status', 'reconciliation_required');
  end if;
  update public.employee_payout_transactions set
    status = 'uncertain', failure_category = left(coalesce(p_failure_category, 'uncertain'), 48),
    updated_at = now()
    where id = v_transaction.id;
  update public.employee_withdrawal_requests set status = 'reconciliation_required'
    where id = p_withdrawal_id and status in ('processing','approved','reconciliation_required');
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
    values ('system', 'daraja_b2b', 'payout_reconciliation_required', 'withdrawal',
            p_withdrawal_id::text, jsonb_build_object('category', left(coalesce(p_failure_category, 'uncertain'), 48)));
  return jsonb_build_object('status', 'reconciliation_required');
end;
$$;

create or replace function public.employee_process_daraja_b2b_result(
  p_withdrawal_id uuid,
  p_callback_token_hash text,
  p_originator_reference text,
  p_conversation_id text,
  p_result_code integer,
  p_amount numeric,
  p_receipt text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_transaction public.employee_payout_transactions%rowtype;
  v_request public.employee_withdrawal_requests%rowtype;
  v_success boolean;
begin
  select * into v_transaction from public.employee_payout_transactions
    where withdrawal_id = p_withdrawal_id and provider = 'daraja_b2b' for update;
  if not found or p_callback_token_hash is null
     or v_transaction.callback_token_hash is distinct from p_callback_token_hash
     or p_originator_reference is null
     or v_transaction.originator_reference <> p_originator_reference then
    raise exception 'B2B payout callback authentication failed.';
  end if;
  if v_transaction.status = 'succeeded' then
    return jsonb_build_object('status', 'paid', 'duplicate', true);
  end if;
  if v_transaction.status = 'failed' then
    return jsonb_build_object('status', 'reconciliation_required', 'duplicate', true);
  end if;
  if p_conversation_id is not null and v_transaction.provider_conversation_id is not null
     and v_transaction.provider_conversation_id <> p_conversation_id then
    raise exception 'B2B payout callback correlation failed.';
  end if;
  select * into v_request from public.employee_withdrawal_requests
    where id = p_withdrawal_id for update;
  if not found or v_request.status not in ('processing','reconciliation_required','approved') then
    raise exception 'B2B payout is not in a callback-eligible state.';
  end if;

  v_success := p_result_code = 0
    and p_amount = v_transaction.expected_amount
    and p_receipt is not null
    and p_receipt ~ '^[A-Za-z0-9]{6,20}$';

  if v_success then
    update public.employee_payout_transactions set
      status = 'succeeded', provider_conversation_id = coalesce(provider_conversation_id, p_conversation_id),
      provider_receipt = p_receipt, result_code = '0', callback_received_at = now(),
      failure_category = null, updated_at = now()
      where id = v_transaction.id;
    update public.employee_withdrawal_requests set
      status = 'paid', paid_reference = p_receipt, paid_at = now()
      where id = p_withdrawal_id;
    insert into public.employee_financial_ledger(
      employee_id, entry_type, amount, reference, idempotency_key, created_by
    ) values
      (v_request.employee_id, 'withdrawal_release', v_request.amount, p_withdrawal_id::text,
       'withdrawal-release:' || p_withdrawal_id::text, 'daraja_b2b'),
      (v_request.employee_id, 'withdrawal_debit', -v_request.amount, p_withdrawal_id::text,
       'withdrawal-debit:' || p_withdrawal_id::text, 'daraja_b2b')
    on conflict (idempotency_key) do nothing;
    insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
      values ('system', 'daraja_b2b', 'withdrawal_paid_verified', 'withdrawal',
              p_withdrawal_id::text, jsonb_build_object('receipt', p_receipt, 'amount', v_request.amount));
    return jsonb_build_object('status', 'paid', 'duplicate', false);
  end if;

  if p_result_code <> 0 then
    update public.employee_payout_transactions set
      status = 'failed', result_code = p_result_code::text,
      provider_conversation_id = coalesce(provider_conversation_id, p_conversation_id),
      callback_received_at = now(), failure_category = 'provider_failed', updated_at = now()
      where id = v_transaction.id;
    insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
      values ('system', 'daraja_b2b', 'withdrawal_provider_failure', 'withdrawal',
              p_withdrawal_id::text, jsonb_build_object('result_code', p_result_code));
  else
    update public.employee_payout_transactions set
      status = 'uncertain', result_code = p_result_code::text,
      provider_conversation_id = coalesce(provider_conversation_id, p_conversation_id),
      callback_received_at = now(), failure_category = 'callback_validation_failed', updated_at = now()
      where id = v_transaction.id;
    insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
      values ('system', 'daraja_b2b', 'withdrawal_callback_needs_reconciliation', 'withdrawal',
              p_withdrawal_id::text, jsonb_build_object('result_code', p_result_code));
  end if;
  update public.employee_withdrawal_requests set status = 'reconciliation_required'
    where id = p_withdrawal_id and status <> 'paid';
  return jsonb_build_object('status', 'reconciliation_required', 'duplicate', false);
end;
$$;

create or replace function public.employee_record_manual_pochi_payout(
  p_withdrawal_id uuid,
  p_actor_id text,
  p_payment_reference text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_request public.employee_withdrawal_requests%rowtype;
  v_destination_type text;
begin
  if p_actor_id is null or p_actor_id <> 'super_admin'
     or p_payment_reference is null or p_payment_reference !~ '^[A-Za-z0-9]{6,20}$' then
    raise exception 'A verified Safaricom reference and Super Admin are required.';
  end if;
  select * into v_request from public.employee_withdrawal_requests
    where id = p_withdrawal_id for update;
  if not found or v_request.status <> 'approved' then
    raise exception 'Only an approved Pochi payout with no prior send can be recorded.';
  end if;
  select destination_type into v_destination_type
    from public.employee_payout_destinations
    where id = v_request.destination_id and employee_id = v_request.employee_id and status = 'active';
  if v_destination_type <> 'pochi' then
    raise exception 'Manual Pochi recording is limited to approved Pochi destinations.';
  end if;
  if exists (select 1 from public.employee_payout_transactions where withdrawal_id = p_withdrawal_id) then
    raise exception 'A payout transaction already exists; reconcile it before recording another payment.';
  end if;

  update public.employee_withdrawal_requests set
    status = 'paid', paid_reference = p_payment_reference, paid_at = now()
    where id = p_withdrawal_id;
  insert into public.employee_financial_ledger(employee_id, entry_type, amount, reference, idempotency_key, created_by)
    values
      (v_request.employee_id, 'withdrawal_release', v_request.amount,
       p_withdrawal_id::text, 'withdrawal-release:' || p_withdrawal_id::text, p_actor_id),
      (v_request.employee_id, 'withdrawal_debit', -v_request.amount,
       p_withdrawal_id::text, 'withdrawal-debit:' || p_withdrawal_id::text, p_actor_id);
  insert into public.employee_payout_transactions(
    withdrawal_id, provider, originator_reference, status, provider_receipt, result_code, updated_at
  ) values (
    p_withdrawal_id, 'b2pochi', 'manual-pochi:' || p_withdrawal_id::text, 'succeeded',
    p_payment_reference, 'manual_admin_confirmed', now()
  );
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
    values ('super_admin', p_actor_id, 'manual_pochi_payout_confirmed', 'withdrawal',
            p_withdrawal_id::text, jsonb_build_object('receipt', p_payment_reference, 'amount', v_request.amount));
  return jsonb_build_object('id', p_withdrawal_id, 'status', 'paid');
end;
$$;

revoke all on function public.employee_review_withdrawal_and_claim_daraja_b2b(uuid, text, text, text, text, text, text, text) from public;
revoke all on function public.employee_mark_daraja_b2b_submitted(uuid, text, text) from public;
revoke all on function public.employee_mark_daraja_b2b_uncertain(uuid, text, text, text) from public;
revoke all on function public.employee_process_daraja_b2b_result(uuid, text, text, text, integer, numeric, text) from public;
revoke all on function public.employee_record_manual_pochi_payout(uuid, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.employee_review_withdrawal_and_claim_daraja_b2b(uuid, text, text, text, text, text, text, text) to service_role;
    grant execute on function public.employee_mark_daraja_b2b_submitted(uuid, text, text) to service_role;
    grant execute on function public.employee_mark_daraja_b2b_uncertain(uuid, text, text, text) to service_role;
    grant execute on function public.employee_process_daraja_b2b_result(uuid, text, text, text, integer, numeric, text) to service_role;
    grant execute on function public.employee_record_manual_pochi_payout(uuid, text, text) to service_role;
  end if;
end $$;
