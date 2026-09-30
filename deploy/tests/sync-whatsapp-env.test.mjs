import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { syncWhatsAppEnv } from "../sync-whatsapp-env.mjs";

test("syncs provided WhatsApp secrets while preserving unrelated VPS settings", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "whatsapp-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, ".env");
  await writeFile(envPath, "KEEP_EXISTING=value\nWHATSAPP_ACCESS_TOKEN=old-token\n");

  const updated = await syncWhatsAppEnv({
    envPath,
    env: {
      WHATSAPP_ACCESS_TOKEN: "new-token",
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token",
      WHATSAPP_APP_SECRET: "",
      WHATSAPP_PHONE_NUMBER_ID: "123456789",
    },
  });

  const content = await readFile(envPath, "utf8");
  assert.deepEqual(updated, [
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
  ]);
  assert.match(content, /^KEEP_EXISTING=value$/m);
  assert.doesNotMatch(content, /^WHATSAPP_ACCESS_TOKEN=old-token$/m);
  assert.match(content, /^WHATSAPP_ACCESS_TOKEN="new-token"$/m);
  assert.match(content, /^WHATSAPP_WEBHOOK_VERIFY_TOKEN="verify-token"$/m);
  assert.match(content, /^WHATSAPP_PHONE_NUMBER_ID="123456789"$/m);
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
});

test("leaves existing credentials untouched when GitHub Actions secrets are absent", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "whatsapp-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, ".env");
  const original = "WHATSAPP_ACCESS_TOKEN=already-configured\nKEEP_EXISTING=value\n";
  await writeFile(envPath, original);

  const updated = await syncWhatsAppEnv({ envPath, env: {} });

  assert.deepEqual(updated, []);
  assert.equal(await readFile(envPath, "utf8"), original);
});

test("quotes shell-sensitive token characters without exposing values", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "whatsapp-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, ".env");
  const token = "token$with`special\\chars";

  await syncWhatsAppEnv({
    envPath,
    env: { WHATSAPP_ACCESS_TOKEN: token },
  });

  const content = await readFile(envPath, "utf8");
  assert.match(content, /^WHATSAPP_ACCESS_TOKEN="token\\\$with\\`special\\\\chars"$/m);
  const shell = spawnSync(
    "bash",
    ["-c", 'set -a; source "$1"; printf "%s" "$WHATSAPP_ACCESS_TOKEN"', "bash", envPath],
    { encoding: "utf8" },
  );
  assert.equal(shell.status, 0, shell.stderr);
  assert.equal(shell.stdout, token);
});

test("rejects multiline secrets rather than corrupting the environment file", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "whatsapp-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, ".env");
  await writeFile(envPath, "KEEP_EXISTING=value\n");
  await chmod(envPath, 0o600);

  await assert.rejects(
    syncWhatsAppEnv({
      envPath,
      env: { WHATSAPP_ACCESS_TOKEN: "token\nINJECTED=value" },
    }),
    /WHATSAPP_ACCESS_TOKEN must be a single-line value/,
  );
  assert.equal(await readFile(envPath, "utf8"), "KEEP_EXISTING=value\n");
});