import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

test("dashboard usage sampling is scoped, bounded, and uses existing live reads", async () => {
  const [migration, runner, route] = await Promise.all([
    readFile(new URL("../../migrations/2026_dashboard_usage_samples.sql", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url), "utf8"),
    readFile(new URL("./mikrotik-route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /unique \(account_id, router_id, scope_key, sampled_at\)/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /to service_role/i);
  assert.match(runner, /2026_dashboard_usage_samples\.sql/);
  assert.match(route, /fetchRouterLiveData\(found\.creds\)/);
  assert.match(route, /Date\.now\(\) - lastWrite < 5 \* 60 \* 1000/);
  assert.match(route, /account_id=eq\.\$\{account\.id\}&scope_key=eq\./);
  assert.match(route, /dashboard_usage_samples/);
});
