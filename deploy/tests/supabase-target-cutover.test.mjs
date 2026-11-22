import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("manual cutover build uses destination secrets and keeps the deploy step isolated", async () => {
  const workflow = await read(".github/workflows/deploy.yml");
  assert.match(workflow, /supabase_target_cutover:\n\s+description:/);
  assert.match(workflow, /VITE_SUPABASE_URL: \$\{\{ secrets\.SUPABASE_DEST_URL \}\}/);
  assert.match(workflow, /VITE_SUPABASE_KEY: \$\{\{ secrets\.SUPABASE_DEST_PUBLISHABLE_KEY \}\}/);
  assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_DEST_SERVICE_ROLE_KEY \}\}/);
  assert.match(workflow, /SUPABASE_DB_URL: \$\{\{ secrets\.SUPABASE_DEST_DB_URL \}\}/);
  assert.doesNotMatch(workflow, /secrets\.VITE_SUPABASE_URL|secrets\.VITE_SUPABASE_KEY|secrets\.SUPABASE_SERVICE_ROLE_KEY|secrets\.SUPABASE_DB_URL/);
  assert.match(workflow, /validate-supabase-cutover-config\.mjs/);
  assert.match(workflow, /verify-supabase-build-target\.mjs/);
  assert.match(workflow, /DEPLOY_APP_ONLY="\$\{APP_ONLY_RELEASE:-false\}"/);
  assert.match(workflow, /DEPLOY_SKIP_ROUTER_ONESHOTS:.*inputs\.supabase_target_cutover/);

  const sshStep = workflow.slice(
    workflow.indexOf("- name: Deploy via SSH"),
    workflow.indexOf("\n      - name:", workflow.indexOf("- name: Deploy via SSH") + 1),
  );
  assert.match(sshStep, /SUPABASE_TARGET_CUTOVER,SUPABASE_DEST_URL,SUPABASE_DEST_PUBLISHABLE_KEY,SUPABASE_DEST_SERVICE_ROLE_KEY,SUPABASE_DEST_DB_URL,APP_ONLY_RELEASE/);
  const targetStart = sshStep.indexOf('if [ "${SUPABASE_TARGET_CUTOVER:-false}" = "true" ]');
  const targetEnd = sshStep.indexOf("else\n            # Inject Supabase credentials", targetStart);
  assert.ok(targetStart >= 0 && targetEnd > targetStart);
  const cutoverBranch = sshStep.slice(targetStart, targetEnd);
  assert.match(cutoverBranch, /update-supabase-target-env\.sh/);
  assert.doesNotMatch(cutoverBranch, /validate-r2-env|sync-whatsapp-env|configure-nginx|router.*sync/i);
});

test("app-only guard runs before database tooling, schema changes, or infrastructure", async () => {
  const deploy = await read("deploy/deploy.sh");
  const cutoverGuard = deploy.indexOf('case "${DEPLOY_APP_ONLY:-false}" in');
  const packagePreparation = deploy.indexOf("ensure_pg_dump_available\n");
  const databaseMigrations = deploy.indexOf("apply_supabase_migration() {");
  assert.ok(cutoverGuard >= 0 && cutoverGuard < packagePreparation);
  assert.ok(databaseMigrations > cutoverGuard);
  assert.match(deploy.slice(cutoverGuard, databaseMigrations), /app-only-release\.sh[\s\S]*?exit 0/);

  const appOnly = await read("deploy/app-only-release.sh");
  assert.match(appOnly, /verify-supabase-runtime-target\.mjs/);
  assert.ok(appOnly.indexOf("verify-supabase-runtime-target.mjs") < appOnly.indexOf('rsync -a --delete'));
  assert.match(appOnly, /pm2 reload ecosystem\.config\.cjs --env standalone --update-env/);
  assert.doesNotMatch(appOnly.slice(appOnly.indexOf('rsync -a --delete')), /curl/);
});

test("Super Admin platform table reads use the authenticated server API", async () => {
  const dashboard = await read("artifacts/ochola-supernet/src/pages/super-admin/Dashboard.tsx");
  assert.match(dashboard, /superAdminApiFetch\("\/api\/super-admin\/platform-data"/);
  assert.doesNotMatch(dashboard, /supabase\.from\(/);
});

test("build guard accepts only the approved destination without printing its URL", async () => {
  const guard = await read("deploy/verify-supabase-build-target.mjs");
  assert.match(guard, /vuvyweofsutgqdtbjckj/);
  assert.match(guard, /value not shown/);
});
