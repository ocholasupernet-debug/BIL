import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the active gateway selector reads the shared preference it saves", async () => {
  const route = await readFile(new URL("./settings-route.ts", import.meta.url), "utf8");
  const preferenceGet = route.match(/router\.get\("\/admin\/payment-gateway"([\s\S]*?)\n\}\);/);

  assert.ok(preferenceGet, "active gateway preference endpoint must be present");
  assert.match(
    preferenceGet[1],
    /getAdminPaymentSettings\(adminId,\s*\{\s*useSharedGateway:\s*true\s*\}\)/,
  );
});

test("the repeatable gateway migration preserves every gateway supported by the API", async () => {
  const [migration, routing, runner] = await Promise.all([
    readFile(new URL("../../migrations/2026_admin_payment_gateway.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/payment-routing.ts", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url), "utf8"),
  ]);
  const supported = routing.match(/PAYMENT_GATEWAY_IDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  const migrationAllowList = migration.match(/payment_gateway\s+not in\s*\(([\s\S]*?)\)/i);

  assert.ok(supported, "API gateway allow-list must be present");
  assert.ok(migrationAllowList, "gateway normalization migration must have an explicit allow-list");
  const supportedIds = [...supported[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
  const normalizedIds = [...migrationAllowList[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();

  assert.deepEqual(normalizedIds, supportedIds);
  assert.match(runner, /2026_admin_payment_gateway\.sql/);
});
