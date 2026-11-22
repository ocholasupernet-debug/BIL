import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("destination cutover workflow is scoped to the approved app-only path", async () => {
  const workflow = await read(".github/workflows/deploy.yml");
  assert.match(workflow, /supabase_target_cutover:\n\s+description:/);
  assert.match(workflow, /SUPABASE_DEST_URL: \$\{\{ secrets\.SUPABASE_DEST_URL \}\}/);
  assert.match(workflow, /SUPABASE_DEST_PUBLISHABLE_KEY: \$\{\{ secrets\.SUPABASE_DEST_PUBLISHABLE_KEY \}\}/);
  assert.match(workflow, /SUPABASE_DEST_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_DEST_SERVICE_ROLE_KEY \}\}/);
  assert.match(workflow, /SUPABASE_DEST_DB_URL: \$\{\{ secrets\.SUPABASE_DEST_DB_URL \}\}/);
  assert.match(workflow, /VITE_SUPABASE_URL: \$\{\{ secrets\.SUPABASE_DEST_URL \}\}/);
  assert.match(workflow, /VITE_SUPABASE_KEY: \$\{\{ secrets\.SUPABASE_DEST_PUBLISHABLE_KEY \}\}/);
  assert.doesNotMatch(workflow, /secrets\.VITE_SUPABASE_URL|secrets\.VITE_SUPABASE_KEY|secrets\.SUPABASE_SERVICE_ROLE_KEY|secrets\.SUPABASE_DB_URL/);
  assert.match(workflow, /validate-supabase-cutover-config\.mjs/);
  assert.match(workflow, /verify-supabase-build-target\.mjs/);

  const sshStart = workflow.indexOf("- name: Deploy via SSH");
  const sshEnd = workflow.indexOf("\n      - name:", sshStart + 1);
  const sshStep = workflow.slice(sshStart, sshEnd);
  const envsExpression = sshStep.match(/envs:\s*\$\{\{\s*([\s\S]*?)\s*\}\}/)?.[1] ?? "";
  assert.match(
    envsExpression,
    /inputs\.supabase_target_cutover\s*&&\s*'SUPABASE_TARGET_CUTOVER,SUPABASE_DEST_URL,SUPABASE_DEST_PUBLISHABLE_KEY,SUPABASE_DEST_SERVICE_ROLE_KEY,SUPABASE_DEST_DB_URL,APP_ONLY_RELEASE,DEPLOY_REFRESH_PM2_ENV,DEPLOY_VERIFY_SUPABASE_TARGET,DEPLOY_SKIP_ROUTER_MANAGEMENT_SETUP,DEPLOY_SKIP_ROUTER_ONESHOTS'/,
  );
  const start = sshStep.indexOf('if [ "${SUPABASE_TARGET_CUTOVER:-false}" = "true" ]');
  const end = sshStep.indexOf('elif [ "${APP_ONLY_RELEASE:-false}" = "true" ]', start);
  assert.ok(start >= 0 && end > start);
  const cutoverBlock = sshStep.slice(start, end);
  assert.match(cutoverBlock, /update-supabase-target-env\.sh/);
  assert.match(cutoverBlock, /rollback_supabase_target/);
  assert.doesNotMatch(cutoverBlock, /sync-whatsapp-env|configure-nginx|CLOUDFLARE|R2|router.*sync/i);
  assert.match(sshStep, /if \[ "\$\{SUPABASE_TARGET_CUTOVER:-false\}" = "true" \]; then[\s\S]*?exit 0/);
});

test("app-only guard runs before PostgreSQL tooling and database migrations", async () => {
  const deploy = await read("deploy/deploy.sh");
  const guard = deploy.indexOf('case "${DEPLOY_APP_ONLY:-false}" in');
  const pgToolSetup = deploy.indexOf("ensure_pg_dump_available\n");
  const migrations = deploy.indexOf("apply_supabase_migration() {");
  assert.ok(guard >= 0 && guard < pgToolSetup);
  assert.ok(migrations > guard);
  assert.match(deploy.slice(guard, pgToolSetup), /app-only-release\.sh[\s\S]*?exit 0/);

  const appOnly = await read("deploy/app-only-release.sh");
  assert.ok(appOnly.indexOf("verify-supabase-runtime-target.mjs") < appOnly.indexOf("rsync -a --delete"));
  assert.match(appOnly, /pm2 reload ecosystem\.config\.cjs --env standalone --update-env/);
  assert.doesNotMatch(appOnly.slice(appOnly.indexOf("rsync -a --delete")), /curl/);
});

test("Super Admin dashboard uses the authenticated server API and keeps migration access visible", async () => {
  const dashboard = await read("artifacts/ochola-supernet/src/pages/super-admin/Dashboard.tsx");
  assert.match(dashboard, /superAdminApiFetch\("\/api\/super-admin\/platform-data"/);
  assert.doesNotMatch(dashboard, /supabase\.from\(/);
  assert.match(dashboard, /href="\/super-admin\/supabase-migration"/);
});
