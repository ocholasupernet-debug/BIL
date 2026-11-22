import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const updater = path.join(root, "deploy/update-supabase-target-env.sh");
const destination = {
  SUPABASE_DEST_URL: "https://vuvyweofsutgqdtbjckj.supabase.co",
  SUPABASE_DEST_PUBLISHABLE_KEY: "destination-publishable-test",
  SUPABASE_DEST_SERVICE_ROLE_KEY: "destination 'service' $value",
  SUPABASE_DEST_DB_URL: "postgresql://postgres.vuvyweofsutgqdtbjckj:example@aws-0-us-east-1.pooler.supabase.com:5432/db",
};

test("switches only Supabase targets, preserves rollback values, and keeps .env private", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bil-supabase-target-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const envFile = path.join(dir, ".env");
  await writeFile(envFile, [
    "VITE_SUPABASE_URL=https://qfsxsbzaqwmyuxhramyw.supabase.co",
    "SUPABASE_URL=https://qfsxsbzaqwmyuxhramyw.supabase.co",
    "VITE_SUPABASE_KEY=source-publishable-test",
    "SUPABASE_SERVICE_ROLE_KEY=source-service-test",
    "SUPABASE_SERVICE_KEY=source-legacy-service-test",
    "SUPABASE_DB_URL=postgresql://postgres.qfsxsbzaqwmyuxhramyw:example@pooler.test/db",
    "SUPABASE_DATABASE_URL=postgresql://postgres.qfsxsbzaqwmyuxhramyw:example@pooler.test/db",
    "CLOUDFLARE_R2_BUCKET_BIL=bil-storage",
    "SESSION_SECRET=unrelated-test-setting",
    "",
  ].join("\n"), { mode: 0o600 });

  const result = spawnSync("bash", [updater], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      PROJECT_DIR: dir,
      SUPABASE_ENV_FILE: envFile,
      ...destination,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /source-service-test|destination 'service' \$value/);

  const contents = await readFile(envFile, "utf8");
  for (const name of [
    "VITE_SUPABASE_URL",
    "SUPABASE_URL",
    "VITE_SUPABASE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_DB_URL",
    "SUPABASE_DATABASE_URL",
    "SUPABASE_DEST_URL",
    "SUPABASE_DEST_PUBLISHABLE_KEY",
    "SUPABASE_DEST_SERVICE_ROLE_KEY",
    "SUPABASE_DEST_DB_URL",
  ]) {
    assert.ok(contents.includes(`${name}=`), `${name} should be present`);
  }
  assert.doesNotMatch(contents, /SUPABASE_ROLLBACK_/);
  const rollbackFile = path.join(dir, ".env.supabase-rollback");
  const rollbackContents = await readFile(rollbackFile, "utf8");

  const valuesCheck = spawnSync("bash", ["-c", `
    set -a
    source "$1"
    source "$2"
    set +a
    [[ "$SUPABASE_ROLLBACK_VITE_SUPABASE_URL" == "$EXPECTED_SOURCE_URL" ]] &&
    [[ "$SUPABASE_ROLLBACK_VITE_SUPABASE_KEY" == "$EXPECTED_SOURCE_PUBLISHABLE" ]] &&
    [[ "$SUPABASE_ROLLBACK_SERVICE_ROLE_KEY" == "$EXPECTED_SOURCE_SERVICE" ]] &&
    [[ "$VITE_SUPABASE_URL" == "$EXPECTED_DEST_URL" ]] &&
    [[ "$VITE_SUPABASE_KEY" == "$EXPECTED_DEST_PUBLISHABLE" ]] &&
    [[ "$SUPABASE_SERVICE_ROLE_KEY" == "$EXPECTED_DEST_SERVICE" ]] &&
    [[ "$SUPABASE_DB_URL" == "$EXPECTED_DEST_DB" ]] &&
    [[ "$SUPABASE_DEST_SERVICE_ROLE_KEY" == "$EXPECTED_DEST_SERVICE" ]]
  `, "test", envFile, rollbackFile], {
    encoding: "utf8",
    env: {
      ...process.env,
      EXPECTED_SOURCE_URL: "https://qfsxsbzaqwmyuxhramyw.supabase.co",
      EXPECTED_SOURCE_PUBLISHABLE: "source-publishable-test",
      EXPECTED_SOURCE_SERVICE: "source-service-test",
      EXPECTED_DEST_URL: destination.SUPABASE_DEST_URL,
      EXPECTED_DEST_PUBLISHABLE: destination.SUPABASE_DEST_PUBLISHABLE_KEY,
      EXPECTED_DEST_SERVICE: destination.SUPABASE_DEST_SERVICE_ROLE_KEY,
      EXPECTED_DEST_DB: destination.SUPABASE_DEST_DB_URL,
    },
  });
  assert.equal(valuesCheck.status, 0, "quoted destination and rollback values should be recoverable");
  assert.doesNotMatch(rollbackContents, /destination/);
  assert.match(rollbackContents, /SUPABASE_ROLLBACK_SERVICE_ROLE_KEY=/);
  assert.match(contents, /CLOUDFLARE_R2_BUCKET_BIL=bil-storage/);
  assert.match(contents, /SESSION_SECRET=unrelated-test-setting/);
  assert.equal((await stat(envFile)).mode & 0o777, 0o600);
  assert.equal((await stat(rollbackFile)).mode & 0o777, 0o600);
});

test("refuses a mismatched destination without changing .env", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bil-supabase-target-refuse-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const envFile = path.join(dir, ".env");
  const before = "VITE_SUPABASE_URL=https://qfsxsbzaqwmyuxhramyw.supabase.co\n";
  await writeFile(envFile, before, { mode: 0o600 });

  const result = spawnSync("bash", [updater], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      PROJECT_DIR: dir,
      SUPABASE_ENV_FILE: envFile,
      ...destination,
      SUPABASE_DEST_URL: "https://qfsxsbzaqwmyuxhramyw.supabase.co",
    },
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /destination 'service' \$value|source\.supabase\.co/);
  assert.equal(await readFile(envFile, "utf8"), before);
});
