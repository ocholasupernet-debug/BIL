import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createTawkIdentity,
  hashChatPassword,
  normalizeChatUsername,
  verifyChatPassword,
} from "./hotspot-chat-account.js";

test("chat usernames are normalized and constrained", () => {
  assert.equal(normalizeChatUsername("  Rose.Net-7 "), "rose.net-7");
  assert.equal(normalizeChatUsername("ab"), null);
  assert.equal(normalizeChatUsername("two words"), null);
  assert.equal(normalizeChatUsername("x".repeat(33)), null);
});

test("chat passwords use salted scrypt hashes and verify without plaintext storage", () => {
  const first = hashChatPassword("strong-chat-pass");
  const second = hashChatPassword("strong-chat-pass");
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, "strong-chat-pass");
  assert.equal(verifyChatPassword("strong-chat-pass", first.salt, first.hash), true);
  assert.equal(verifyChatPassword("wrong-password", first.salt, first.hash), false);
});

test("Tawk identity is stable per account and signed server-side", () => {
  const first = createTawkIdentity("test-api-key", "account-uuid");
  const again = createTawkIdentity("test-api-key", "account-uuid");
  const otherKey = createTawkIdentity("different-key", "account-uuid");
  assert.deepEqual(first, again);
  assert.equal(first.userId, "account-uuid");
  assert.notEqual(first.hash, otherKey.hash);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
});

test("chat accounts are tenant-scoped, private to service_role, and migration is registered", () => {
  const migration = readFileSync(new URL("../../migrations/2026_hotspot_chat_accounts.sql", import.meta.url), "utf8");
  const runner = readFileSync(new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../routes/index.ts", import.meta.url), "utf8");
  assert.match(migration, /unique \(admin_id, username_key\)/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on public\.isp_hotspot_chat_accounts from anon, authenticated/i);
  assert.match(runner, /2026_hotspot_chat_accounts\.sql/);
  assert.match(routes, /import hotspotChatRouter from "\.\/hotspot-chat-route\.js"/);
  assert.match(routes, /router\.use\(hotspotChatRouter\)/);
});
