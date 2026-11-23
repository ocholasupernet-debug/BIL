import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migration = readFileSync(
  fileURLToPath(new URL("../../migrations/2026_employee_daraja_b2b_and_manual_pochi.sql", import.meta.url)),
  "utf8",
);
const reconciliationMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/2026_employee_daraja_manual_reconciliation.sql", import.meta.url)),
  "utf8",
);

test("B2B automation defaults off and the merchant/pochi migration is additive", () => {
  assert.match(migration, /add column if not exists automatic_b2b_enabled boolean not null default false/i);
  assert.match(migration, /add column if not exists b2b_environment text not null default 'sandbox'/i);
  assert.match(migration, /p_destination_type = 'paybill' and p_command <> 'BusinessPayBill'/i);
  assert.match(migration, /p_destination_type = 'till' and p_command <> 'BusinessBuyGoods'/i);
  assert.match(migration, /where provider = 'daraja_b2b' and provider_receipt is not null/i);
  assert.doesNotMatch(migration, /\b(drop table|truncate|delete from)\b/i);
});

test("B2B payout only debits after a matched success callback and Pochi is admin-recorded", () => {
  const b2b = migration.slice(
    migration.indexOf("function public.employee_process_daraja_b2b_result"),
    migration.indexOf("create or replace function public.employee_record_manual_pochi_payout"),
  );
  assert.match(b2b, /callback_token_hash is distinct from p_callback_token_hash/i);
  assert.match(b2b, /originator_reference <> p_originator_reference/i);
  assert.match(b2b, /p_amount = v_transaction\.expected_amount/i);
  assert.match(b2b, /p_receipt ~ '\^\[A-Za-z0-9\]\{6,20\}\$'/i);
  const success = b2b.slice(b2b.indexOf("if v_success then"), b2b.indexOf("if p_result_code <> 0 then"));
  const failure = b2b.slice(b2b.indexOf("if p_result_code <> 0 then"));
  assert.match(success, /insert into public\.employee_financial_ledger/i);
  assert.doesNotMatch(failure, /insert into public\.employee_financial_ledger/i);

  const pochi = migration.slice(migration.indexOf("function public.employee_record_manual_pochi_payout"));
  assert.match(pochi, /p_actor_id <> 'super_admin'/i);
  assert.match(pochi, /v_request\.status <> 'approved'/i);
  assert.match(pochi, /v_destination_type <> 'pochi'/i);
  assert.match(pochi, /p_payment_reference !~ '\^\[A-Za-z0-9\]\{6,20\}\$'/i);
});

test("manual reconciliation is Super Admin-only, amount-matched, and releases or debits exactly once", () => {
  assert.match(reconciliationMigration, /p_actor_id <> 'super_admin'/i);
  assert.match(reconciliationMigration, /v_request\.status <> 'reconciliation_required'/i);
  assert.match(reconciliationMigration, /provider in \('daraja_b2c', 'daraja_b2b'\)/i);
  assert.match(reconciliationMigration, /v_transaction\.expected_amount <> p_amount/i);
  assert.match(reconciliationMigration, /withdrawal-reserve:/i);
  const success = reconciliationMigration.slice(
    reconciliationMigration.indexOf("if p_outcome = 'success' then"),
    reconciliationMigration.indexOf("else\n    update public.employee_payout_transactions set\n      status = 'failed'"),
  );
  const failure = reconciliationMigration.slice(
    reconciliationMigration.indexOf("else\n    update public.employee_payout_transactions set\n      status = 'failed'"),
    reconciliationMigration.indexOf("insert into public.employee_audit_logs"),
  );
  assert.match(success, /withdrawal-debit:/i);
  assert.match(success, /provider_receipt = p_provider_reference/i);
  assert.match(failure, /withdrawal_release/i);
  assert.doesNotMatch(failure, /withdrawal-debit:/i);
  assert.doesNotMatch(reconciliationMigration, /\b(drop table|truncate|delete from)\b/i);
});
