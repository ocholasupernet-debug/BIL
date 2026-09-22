import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("migrations/2026_port_service_provisioning_status.sql", "utf8");
const runner = await readFile("scripts/apply-deployment-migrations.mjs", "utf8");

test("port-service status migration allows the provisioning state used by deployments", () => {
  assert.match(migration, /drop constraint if exists isp_reseller_ports_status_check/);
  assert.match(migration, /status in \('pending', 'provisioning', 'active', 'failed', 'disabled'\)/);
  assert.match(runner, /2026_port_service_provisioning_status\.sql/);
});