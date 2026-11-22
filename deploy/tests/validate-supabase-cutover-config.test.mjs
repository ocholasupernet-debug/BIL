import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "deploy/validate-supabase-cutover-config.mjs");
const env = {
  SUPABASE_DEST_URL: "https://vuvyweofsutgqdtbjckj.supabase.co",
  SUPABASE_DEST_PUBLISHABLE_KEY: "publishable-test-value",
  SUPABASE_DEST_SERVICE_ROLE_KEY: "service-role-test-value",
  SUPABASE_DEST_DB_URL: "postgresql://postgres.vuvyweofsutgqdtbjckj:password@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
};

function run(values) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...values },
  });
}

test("configuration validator accepts complete credentials for the approved destination", () => {
  const result = run(env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /approved destination/);
  assert.doesNotMatch(result.stdout + result.stderr, /password|test-value/);
});

test("configuration validator lists missing names without printing values", () => {
  const result = run({ ...env, SUPABASE_DEST_SERVICE_ROLE_KEY: "" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SUPABASE_DEST_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(result.stdout + result.stderr, /service-role-test-value|password/);
});

test("configuration validator rejects a mismatched database project without revealing credentials", () => {
  const result = run({
    ...env,
    SUPABASE_DEST_DB_URL: "postgresql://postgres.qfsxsbzaqwmyuxhramyw:password@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /identity validation failed/);
  assert.doesNotMatch(result.stdout + result.stderr, /password|service-role-test-value/);
});
