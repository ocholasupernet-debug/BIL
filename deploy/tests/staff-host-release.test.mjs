import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFile(new URL(path, `file://${root}/`), "utf8");

test("Staff host routes to an explicit safe status page without collecting credentials", async () => {
  const app = await read("artifacts/ochola-supernet/src/App.tsx");
  const page = await read("artifacts/ochola-supernet/src/pages/staff/StaffPortalStatusPage.tsx");
  assert.match(app, /hostname\.toLowerCase\(\) === "staff\.isplatty\.com"/);
  assert.match(app, /setLocation\("\/staff\/login"\)/);
  assert.match(app, /<Route path="\/staff\/login" component=\{StaffPortalStatusPage\}/);
  assert.match(page, /Staff sign-in is temporarily unavailable/);
  assert.match(page, /does not collect or store sign-in details/);
  assert.doesNotMatch(page, /\b(fetch|localStorage|sessionStorage)\s*\(/);
});

test("Staff TLS repair is host-specific and never changes application or database state", async () => {
  const script = await read("deploy/restore-staff-host-https.sh");
  assert.match(script, /host=staff\.isplatty\.com/);
  assert.match(script, /server_name staff\.isplatty\.com;/);
  assert.match(script, /-checkhost "\$host"/);
  assert.match(script, /nginx -t/);
  assert.match(script, /systemctl reload nginx/);
  assert.match(script, /rsync -a --delete --delay-updates/);
  assert.match(script, /assets_replaced=true/);
  assert.doesNotMatch(script, /pm2\s+(?:reload|restart|start)|SUPABASE_DB_URL|psql|migration|routeros/i);
  assert.match(script, /refusing to overwrite/);
  assert.match(script, /rolling back the static files and any new Staff vhost/);
});

test("Staff release workflow is manual, branch-scoped, and bypasses the general deploy job", async () => {
  const workflow = await read(".github/workflows/deploy.yml");
  assert.match(workflow, /staff_host_repair:\n\s+description:/);
  assert.match(workflow, /deploy:\n\s+if: \$\{\{ !startsWith\(github\.ref, 'refs\/heads\/deploy\/staff-host-reachability-'\) && !inputs\.staff_host_repair \}\}/);
  assert.match(workflow, /staff-host-repair:\n\s+if: \$\{\{ inputs\.staff_host_repair && startsWith\(github\.ref, 'refs\/heads\/deploy\/staff-host-reachability-'\) && github\.event_name == 'workflow_dispatch' \}\}/);
  assert.match(workflow, /refs\/heads\/deploy\/staff-host-reachability-\*/);
  assert.match(workflow, /workflow_dispatch/);
  assert.doesNotMatch(workflow, /staff-host-repair:[\s\S]*?on:\n\s+push:/);
});
