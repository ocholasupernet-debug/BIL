import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [planRoute, mpesaRoute, autoProvision, migration, migrationRunner, schemaSnapshot] = await Promise.all([
  readFile(new URL("./plans.ts", import.meta.url), "utf8"),
  readFile(new URL("./mpesa-route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/auto-provision.ts", import.meta.url), "utf8"),
  readFile(new URL("../../migrations/2026_prepaid_plan_entitlement_preservation.sql", import.meta.url), "utf8"),
  readFile(new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url), "utf8"),
  readFile(new URL("../../migrations/supabase_schema.sql", import.meta.url), "utf8"),
]);

test("removing a plan archives it when customer or payment references exist", () => {
  const removeHandler = planRoute.slice(planRoute.indexOf('router.delete("/plans/:id"'));
  assert.match(removeHandler, /sbSelectStrict<\{ id: number \}>\("isp_customers", `plan_id=eq\.\$\{id\}/);
  assert.match(removeHandler, /sbSelectStrict<\{ id: number \}>\("isp_transactions", `plan_id=eq\.\$\{id\}/);
  assert.match(removeHandler, /is_active: false, client_can_purchase: false/);
  assert.match(removeHandler, /action: preservePurchases \? "archived" : "deleted"/);
});

test("customer and transaction plan links reject direct deletion and migration is deployed", () => {
  assert.match(migration, /public\.isp_customers/);
  assert.match(migration, /public\.isp_transactions/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.match(migrationRunner, /2026_prepaid_plan_entitlement_preservation\.sql/);
  assert.match(schemaSnapshot, /plan_id\s+bigint references isp_plans\(id\) on delete restrict/);
});

test("prepaid payment writers persist the service scope from the verified plan", () => {
  assert.match(mpesaRoute, /plan_id: plan\.id,\s*router_id: plan\.router_id,\s*port_id: plan\.port_id,\s*type: "hotspot"/);
  const activateCustomerHelper = autoProvision.slice(
    autoProvision.indexOf("async function activateCustomer("),
    autoProvision.indexOf("async function recordTransaction("),
  );
  assert.match(autoProvision, /await activateCustomer\(\s*customer,\s*plan,/);
  assert.match(activateCustomerHelper, /status:\s+customer\.status === "suspended" \? "suspended" : "active"/);
  assert.match(activateCustomerHelper, /router_id: plan\.router_id/);
  assert.match(activateCustomerHelper, /port_id: plan\.port_id/);
  assert.match(autoProvision, /status: "payment_cleared_router_pending",[\s\S]*?router_id: plan\.router_id,[\s\S]*?port_id: plan\.port_id/);
});
