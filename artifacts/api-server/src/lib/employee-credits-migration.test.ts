import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migrationPath = fileURLToPath(new URL("../../migrations/2026_employee_credits_award_codes.sql", import.meta.url));
const ledgerMigrationPath = fileURLToPath(new URL("../../migrations/2026_employee_portal.sql", import.meta.url));
const runnerPath = fileURLToPath(new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url));

test("Staff credits and award codes use exact amounts, unique keys, and hash-only code storage", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /employee_admin_credits[\s\S]*amount numeric\(14,2\)/);
  assert.match(sql, /employee_award_codes[\s\S]*amount numeric\(14,2\)/);
  assert.match(sql, /idempotency_key text not null unique/i);
  assert.match(sql, /code_hash text not null unique check \(code_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.doesNotMatch(sql, /\bcode\s+text\b/i);
  assert.match(sql, /redemption_ledger_id bigint unique/i);
});

test("credit posting and code redemption lock account state and audit duplicates, replays, and outcomes", async () => {
  const [sql, ledgerSql] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(ledgerMigrationPath, "utf8"),
  ]);
  const creditFunction = sql.slice(
    sql.indexOf("function public.employee_admin_post_credit"),
    sql.indexOf("function public.employee_issue_award_code"),
  );
  const redeemFunction = sql.slice(sql.indexOf("function public.employee_redeem_award_code"));
  assert.match(creditFunction, /for update/i);
  assert.match(creditFunction, /on conflict \(idempotency_key\) do nothing/i);
  assert.match(creditFunction, /admin_credit_duplicate_rejected/);
  assert.match(creditFunction, /admin_credit_posted/);
  assert.match(redeemFunction, /for update/i);
  assert.match(redeemFunction, /recipient_mismatch/);
  assert.match(redeemFunction, /already_redeemed/);
  assert.match(redeemFunction, /revoked/);
  assert.match(redeemFunction, /expires_at <= now\(\)/);
  assert.match(redeemFunction, /on conflict \(idempotency_key\) do nothing/i);
  assert.match(redeemFunction, /award_code_redeem_rejected/);
  assert.match(redeemFunction, /award_code_redeemed/);
  assert.match(ledgerSql, /before update or delete on public\.employee_financial_ledger/i);
});

test("new private tables and RPCs are service-role-only and deployment runner includes the additive migration", async () => {
  const [sql, runner] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(runnerPath, "utf8"),
  ]);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.%I from anon/i);
  assert.match(sql, /revoke all on table public\.%I from authenticated/i);
  assert.match(sql, /grant all on table public\.%I to service_role/i);
  assert.match(sql, /revoke all on function public\.employee_redeem_award_code\(uuid, text\) from public/i);
  assert.match(sql, /grant execute on function public\.employee_redeem_award_code\(uuid, text\) to service_role/i);
  assert.match(runner, /migrations\/2026_employee_credits_award_codes\.sql/);
});
