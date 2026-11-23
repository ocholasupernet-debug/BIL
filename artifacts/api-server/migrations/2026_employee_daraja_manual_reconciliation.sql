-- Super Admin reconciliation for provider-uncertain employee payouts.
-- The operator must check the final Safaricom result before using this RPC.
create or replace function public.employee_reconcile_daraja_payout(
  p_withdrawal_id uuid,
  p_actor_id text,
  p_outcome text,
  p_provider_reference text,
  p_amount numeric,
  p_note text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_request public.employee_withdrawal_requests%rowtype;
  v_transaction public.employee_payout_transactions%rowtype;
begin
  if p_actor_id is null or p_actor_id <> 'super_admin'
     or p_outcome is null or p_outcome not in ('success', 'failure')
     or p_provider_reference is null
     or p_provider_reference !~ '^[A-Za-z0-9_-]{6,64}$'
     or p_amount is null or p_amount <= 0
     or p_note is null or length(trim(p_note)) < 12
     or length(p_note) > 500 then
    raise exception 'A confirmed Safaricom result, reference, exact amount, and audit note are required.';
  end if;
  if p_outcome = 'success' and p_provider_reference !~ '^[A-Za-z0-9]{6,20}$' then
    raise exception 'A Safaricom receipt is required for successful payout reconciliation.';
  end if;

  select * into v_request from public.employee_withdrawal_requests
    where id = p_withdrawal_id for update;
  if not found or v_request.status <> 'reconciliation_required' then
    raise exception 'Only an uncertain payout can be reconciled.';
  end if;
  select * into v_transaction from public.employee_payout_transactions
    where withdrawal_id = p_withdrawal_id
      and provider in ('daraja_b2c', 'daraja_b2b')
    for update;
  if not found or v_transaction.status not in ('uncertain', 'failed')
     or v_transaction.expected_amount is null
     or v_transaction.expected_amount <> v_request.amount
     or v_transaction.expected_amount <> p_amount then
    raise exception 'Provider transaction, status, or amount does not match this withdrawal.';
  end if;
  if p_outcome = 'success' and v_transaction.status <> 'uncertain' then
    raise exception 'A provider-reported failure cannot be reconciled as successful.';
  end if;
  if exists (
    select 1 from public.employee_financial_ledger
    where idempotency_key in (
      'withdrawal-release:' || p_withdrawal_id::text,
      'withdrawal-debit:' || p_withdrawal_id::text
    )
  ) then
    raise exception 'Withdrawal ledger entries already exist; manual reconciliation is blocked.';
  end if;
  if not exists (
    select 1 from public.employee_financial_ledger
    where idempotency_key = 'withdrawal-reserve:' || p_withdrawal_id::text
      and employee_id = v_request.employee_id
      and entry_type = 'withdrawal_reserve'
      and amount = -v_request.amount
  ) then
    raise exception 'The matching withdrawal reservation is missing; manual reconciliation is blocked.';
  end if;

  if p_outcome = 'success' then
    update public.employee_payout_transactions set
      status = 'succeeded', provider_receipt = p_provider_reference,
      result_code = 'manual_verified_success', failure_category = null,
      callback_received_at = coalesce(callback_received_at, now()), updated_at = now()
      where id = v_transaction.id;
    update public.employee_withdrawal_requests set
      status = 'paid', paid_reference = p_provider_reference, paid_at = now(),
      review_note = left('Safaricom success verified by Super Admin: ' || trim(p_note), 500),
      reviewed_by = p_actor_id, reviewed_at = now()
      where id = p_withdrawal_id;
    insert into public.employee_financial_ledger(
      employee_id, entry_type, amount, reference, idempotency_key, created_by
    ) values
      (v_request.employee_id, 'withdrawal_release', v_request.amount, p_withdrawal_id::text,
       'withdrawal-release:' || p_withdrawal_id::text, p_actor_id),
      (v_request.employee_id, 'withdrawal_debit', -v_request.amount, p_withdrawal_id::text,
       'withdrawal-debit:' || p_withdrawal_id::text, p_actor_id);
  else
    update public.employee_payout_transactions set
      status = 'failed', provider_conversation_id = coalesce(provider_conversation_id, p_provider_reference),
      result_code = 'manual_verified_failure', failure_category = 'admin_verified_failure',
      callback_received_at = coalesce(callback_received_at, now()), updated_at = now()
      where id = v_transaction.id;
    update public.employee_withdrawal_requests set
      status = 'rejected',
      review_note = left('Safaricom failure verified by Super Admin: ' || trim(p_note), 500),
      reviewed_by = p_actor_id, reviewed_at = now()
      where id = p_withdrawal_id;
    insert into public.employee_financial_ledger(
      employee_id, entry_type, amount, reference, idempotency_key, created_by
    ) values
      (v_request.employee_id, 'withdrawal_release', v_request.amount, p_withdrawal_id::text,
       'withdrawal-release:' || p_withdrawal_id::text, p_actor_id);
  end if;

  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
    values (
      'super_admin', p_actor_id, 'daraja_payout_manually_reconciled', 'withdrawal',
      p_withdrawal_id::text,
      jsonb_build_object(
        'provider', v_transaction.provider,
        'outcome', p_outcome,
        'provider_reference', p_provider_reference,
        'amount', v_request.amount,
        'note', left(trim(p_note), 500)
      )
    );
  return jsonb_build_object('id', p_withdrawal_id, 'status', case when p_outcome = 'success' then 'paid' else 'rejected' end);
end;
$$;

revoke all on function public.employee_reconcile_daraja_payout(uuid, text, text, text, numeric, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.employee_reconcile_daraja_payout(uuid, text, text, text, numeric, text) to service_role;
  end if;
end $$;
