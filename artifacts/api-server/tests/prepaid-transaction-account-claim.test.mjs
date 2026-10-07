import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../migrations/2026_prepaid_transaction_account_claim.sql", import.meta.url),
  "utf8",
);

test("qualifies the transaction customer_id predicate to avoid the output-name collision", () => {
  const update = migration.match(
    /update\s+public\.isp_transactions\s+as\s+payment[\s\S]*?;/i,
  )?.[0];

  assert.ok(update, "the account claim migration must link the payment transaction");
  assert.match(update, /payment\.customer_id\s+is\s+null/i);
  assert.doesNotMatch(update, /(?<![\w.])customer_id\s+is\s+null/i);
});
