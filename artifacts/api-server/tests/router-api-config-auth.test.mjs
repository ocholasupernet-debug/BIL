import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const route = await readFile("src/routes/mikrotik-route.ts", "utf8");
const page = await readFile("../ochola-supernet/src/pages/admin/network/RouterAPIConfig.tsx", "utf8");
const app = await readFile("../ochola-supernet/src/App.tsx", "utf8");

test("router API configuration is available to tenant admins without weakening tenant boundaries", () => {
  assert.match(page, /Full tenant-admin view/);
  assert.doesNotMatch(page, /isSuperAdmin|Only SuperAdmins can edit/);
  assert.match(page, /fetch\("\/api\/router\/test-raw"/);
  assert.match(page, /headers\.Authorization = `Bearer \$\{token\}`/);
  assert.match(app, /path="\/admin\/network\/api-config"\s+component=\{RouterAPIConfig\}/);

  assert.match(route, /router\.get\("\/router\/:id\/test", requireAdmin\(\)/);
  assert.match(route, /getRouterCreds\(id, adminId\)/);
  assert.match(route, /router\.post\("\/router\/test-raw", requireAdmin\(\)/);
  assert.match(route, /router\.post\("\/admin\/router\/manual-config", requireAdmin\(\)/);
  assert.match(route, /authenticatedAdminId\(req, body\.adminId\)/);
});