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
  SUPABASE_DEST_DB_URL: "postgresql://postgres.vuvyweofsutgqdtbjckj:example@pooler.test/db",
};

test("switches only Supabase target entries, saves rollback values, and keeps .env private", async (t) => {
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
  for (const [name, value] of Object.entries({
    SUPABASE_ROLLBACK_URL: "https://qfsxsbzaqwmyuxhramyw.supabase.co",
    SUPABASE_ROLLBACK_PUBLISHABLE_KEY: "source-publishable-test",
    SUPABASE_ROLLBACK_SERVICE_ROLE_KEY: "source-service-test",
    SUPABASE_ROLLBACK_SERVICE_KEY: "source-legacy-service-test",
    VITE_SUPABASE_URL: destination.SUPABASE_DEST_URL,
    SUPABASE_URL: destination.SUPABASE_DEST_URL,
    VITE_SUPABASE_KEY: destination.SUPABASE_DEST_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: destination.SUPABASE_DEST_SERVICE_ROLE_KEY,
    SUPABASE_SERVICE_KEY: destination.SUPABASE_DEST_SERVICE_ROLE_KEY,
    SUPABASE_DB_URL: destination.SUPABASE_DEST_DB_URL,
    SUPABASE_DATABASE_URL: destination.SUPABASE_DEST_DB_URL,
    SUPABASE_DEST_URL: destination.SUPABASE_DEST_URL,
    SUPABASE_DEST_SERVICE_ROLE_KEY: destination.SUPABASE_DEST_SERVICE_ROLE_KEY,
    SUPABASE_DEST_DB_URL: destination.SUPABASE_DEST_DB_URL,
  })) {
    assert.ok(contents.includes(`${name}=`), `${name} should be present`);
    if (!name.startsWith("SUPABASE_ROLLBACK")) {
      assert.ok(contents.includes(`${name}=`));
    }
  }
  assert.match(contents, /CLOUDFLARE_R2_BUCKET_BIL=bil-storage/);
  assert.match(contents, /SESSION_SECRET=unrelated-test-setting/);
  assert.equal((await stat(envFile)).mode & 0o777, 0o600);
});

test("refuses a mismatched destination without changing the existing .env", async (t) => {
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
