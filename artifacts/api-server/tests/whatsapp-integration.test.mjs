import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = path => readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("WhatsApp database migration is included in the external VPS deployment runner", async () => {
  const runner = await read("../scripts/apply-deployment-migrations.mjs");
  assert.match(runner, /2026_whatsapp_integration\.sql/);
});

test("payment notices remain isolated from payment settlement failures", async () => {
  const migration = await read("../migrations/2026_whatsapp_integration.sql");
  const paymentTrigger = migration.match(/create or replace function queue_whatsapp_payment_notification\(\)([\s\S]*?)\$\$;/i)?.[1];
  assert.ok(paymentTrigger, "payment outbox trigger should exist");
  assert.match(paymentTrigger, /phone_verified is true/i);
  assert.match(paymentTrigger, /customerNotifications/i);
  assert.match(paymentTrigger, /exception when others/i);
  assert.match(paymentTrigger, /return new/i);
  assert.match(migration, /create trigger isp_transactions_whatsapp_payment_notice/i);
});

test("subscription and renewal notices use separate verified-recipient outbox events", async () => {
  const migration = await read("../migrations/2026_whatsapp_integration.sql");
  assert.match(migration, /create trigger isp_customers_whatsapp_renewal/i);
  assert.match(migration, /create trigger platform_billing_invoices_whatsapp_notice/i);
  assert.match(migration, /'isp_subscription'/);
  assert.match(migration, /'reseller_subscription'/);
  assert.match(migration, /a\.phone_verified is true/i);
});

test("webhook raw bytes are captured before JSON body parsing", async () => {
  const app = await read("../src/app.ts");
  const rawParser = app.indexOf('express.raw({ type: "application/json"');
  const jsonParser = app.indexOf("express.json(");
  assert.notEqual(rawParser, -1);
  assert.notEqual(jsonParser, -1);
  assert.ok(rawParser < jsonParser, "raw parser must precede the global JSON parser");
});

test("optional public auth config fails closed without breaking existing login screens", async () => {
  const route = await read("../src/routes/whatsapp-route.ts");
  const publicConfig = route.match(/router\.get\("\/whatsapp\/public-config"([\s\S]*?)\n\}\);/i)?.[1];
  assert.ok(publicConfig, "public WhatsApp configuration endpoint should exist");
  assert.match(publicConfig, /catch\s*\(error\)/);
  assert.match(publicConfig, /loginEnabled:\s*false/);
  assert.match(publicConfig, /registrationVerificationEnabled:\s*false/);
  assert.match(publicConfig, /passwordRecoveryEnabled:\s*false/);
});