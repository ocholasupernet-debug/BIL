import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migrationPath = fileURLToPath(new URL("../../migrations/2026_employee_portal.sql", import.meta.url));
const runnerPath = fileURLToPath(new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url));

test("employee ledger schema uses exact numeric KES entries and forbids editing posted rows", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /amount numeric\(14,2\)/);
  assert.match(sql, /currency char\(3\) not null default 'KES'/);
  assert.match(sql, /before update or delete on public\.employee_financial_ledger/);
  assert.match(sql, /post a reversal instead/i);
});

test("withdrawal RPC locks the employee row and reserves funds before returning", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const fn = sql.slice(sql.indexOf("function public.employee_request_withdrawal"), sql.indexOf("function public.employee_review_withdrawal"));
  assert.match(fn, /for update/i);
  assert.match(fn, /sum\(amount\)/i);
  assert.match(fn, /withdrawal_reserve/);
  assert.match(sql, /unique\(employee_id, idempotency_key\)/i);
});

test("payroll posting is monthly, transactional, and protected by unique posting keys", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const fn = sql.slice(sql.indexOf("function public.employee_post_payroll"), sql.indexOf("do $$\ndeclare\n  t text"));
  assert.match(fn, /date_trunc\('month'/i);
  assert.match(fn, /payroll-salary:/);
  assert.match(fn, /on conflict \(idempotency_key\) do nothing/i);
  assert.match(sql, /unique\(payroll_period_id, employee_id\)/i);
});

test("deployment runner includes the new additive migration but no migration is executed by this test", async () => {
  const runner = await readFile(runnerPath, "utf8");
  assert.match(runner, /migrations\/2026_employee_portal\.sql/);
});
