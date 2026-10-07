import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const checkoutMigration = read("../migrations/2026_prepaid_checkout_idempotency.sql");
const claimMigration = read("../migrations/2026_prepaid_transaction_account_claim.sql");
const migrationRunner = read("../scripts/apply-deployment-migrations.mjs");
const route = read("../src/routes/mpesa-route.ts");
const portal = read("../../ochola-supernet/src/pages/portal/HotspotLogin.tsx");

test("database uniquely binds one public payment intent and provider checkout to one transaction", () => {
  assert.match(checkoutMigration, /add column if not exists payment_intent_id text/i);
  assert.match(checkoutMigration, /add column if not exists provider_checkout_id text/i);
  assert.match(checkoutMigration, /unique index if not exists isp_transactions_payment_intent_id_uidx/i);
  assert.match(checkoutMigration, /unique index if not exists isp_transactions_provider_checkout_id_uidx/i);
  assert.match(checkoutMigration, /notify pgrst,\s*'reload schema'/i);

  const checkoutSchemaIndex = migrationRunner.indexOf("2026_prepaid_checkout_idempotency.sql");
  const accountClaimIndex = migrationRunner.indexOf("2026_prepaid_transaction_account_claim.sql");
  assert.ok(checkoutSchemaIndex >= 0 && accountClaimIndex > checkoutSchemaIndex);
});

test("replayed STK intents return the existing prompt instead of creating another transaction", () => {
  assert.match(route, /paymentIntentId\s*=\s*intent\?\.nonce\s*\?\?\s*null/);
  assert.match(route, /payment_intent_id:\s*paymentIntentId/);
  assert.match(route, /respondToExistingStkIntent\(res,\s*paymentIntentId\)/);
  assert.match(route, /provider_checkout_id:\s*checkoutId/);
  assert.ok(
    route.indexOf("if (paymentIntentId && await respondToExistingStkIntent")
      < route.indexOf("if (!allowStkRequest(req, scopedAdminId"),
    "intent replay must be checked before rate limiting or another provider prompt",
  );
});

test("a transaction can create only one linked prepaid account, including a retry after partial persistence", () => {
  assert.match(checkoutMigration, /unique index if not exists isp_customers_hotspot_purchase_transaction_id_uidx/i);
  assert.match(claimMigration, /where customer\.hotspot_purchase_transaction_id = tx\.id/i);
  assert.match(claimMigration, /hotspot_purchase_transaction_id,\s*type/i);
  assert.match(claimMigration, /tx\.id,\s*'hotspot'/i);
});

test("the captive portal blocks rapid duplicate payment submissions synchronously", () => {
  assert.match(portal, /paymentStartInFlight\.current\)\s*return/);
  assert.match(portal, /paymentStartInFlight\.current\s*=\s*true/);
  assert.match(portal, /paymentStartInFlight\.current\s*=\s*false/);
});
