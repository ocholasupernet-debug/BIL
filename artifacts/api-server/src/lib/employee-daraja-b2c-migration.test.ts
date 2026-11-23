import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migration = readFileSync(
  fileURLToPath(new URL("../../migrations/2026_employee_daraja_b2c.sql", import.meta.url)),
  "utf8",
);
const baseMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/2026_employee_portal.sql", import.meta.url)),
  "utf8",
);

test("B2C automation controls default off and the payout migration is additive", () => {
  assert.match(migration, /add column if not exists automatic_b2c_enabled boolean not null default false/i);
  assert.match(migration, /add column if not exists b2c_environment text not null default 'sandbox'/i);
  assert.doesNotMatch(migration, /\b(drop table|truncate|delete from)\b/i);
  assert.match(migration, /where id = p_withdrawal_id for update/i);
  assert.match(migration, /v_request\.status <> 'pending'/i);
  assert.match(migration, /v_destination\.destination_type <> 'mpesa_b2c'/i);
  assert.match(baseMigration, /withdrawal_id uuid not null unique references public\.employee_withdrawal_requests/i);
});

test("callback settlement validates the unguessable token, correlation, amount, receipt, and optional phone", () => {
  const callbackFunction = migration.slice(
    migration.indexOf("function public.employee_process_daraja_b2c_result"),
    migration.indexOf("revoke all on function public.employee_review_withdrawal_and_claim_daraja_b2c"),
  );
  assert.match(callbackFunction, /callback_token_hash is distinct from p_callback_token_hash/i);
  assert.match(callbackFunction, /originator_reference <> p_originator_reference/i);
  assert.match(callbackFunction, /p_amount = v_transaction\.expected_amount/i);
  assert.match(callbackFunction, /p_receipt ~ '\^\[A-Za-z0-9\]\{6,20\}\$'/i);
  assert.match(callbackFunction, /p_phone_hash = v_transaction\.expected_phone_hash/i);
  assert.match(callbackFunction, /'withdrawal-release:' \|\| p_withdrawal_id::text/i);
  assert.match(callbackFunction, /'withdrawal-debit:' \|\| p_withdrawal_id::text/i);
  assert.match(callbackFunction, /status = 'reconciliation_required'/i);
  assert.match(callbackFunction, /if v_transaction\.status = 'succeeded' then\s+return jsonb_build_object\('status', 'paid', 'duplicate', true\)/i);
});

test("only the verified success branch writes the immutable withdrawal ledger entries", () => {
  const callbackFunction = migration.slice(
    migration.indexOf("function public.employee_process_daraja_b2c_result"),
    migration.indexOf("revoke all on function public.employee_review_withdrawal_and_claim_daraja_b2c"),
  );
  const successBranch = callbackFunction.slice(callbackFunction.indexOf("if v_success then"), callbackFunction.indexOf("if p_result_code <> 0 then"));
  const failureBranch = callbackFunction.slice(callbackFunction.indexOf("if p_result_code <> 0 then"));
  assert.match(successBranch, /status = 'paid'/i);
  assert.match(successBranch, /insert into public\.employee_financial_ledger/i);
  assert.doesNotMatch(failureBranch, /insert into public\.employee_financial_ledger/i);
  assert.match(failureBranch, /status = 'reconciliation_required'/i);
});
