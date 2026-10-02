import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  decodeRouterUserSnapshot,
  encodeRouterUserSnapshot,
  RouterUserSnapshotTooLargeError,
} from "./router-user-snapshot-service.js";

process.env.SESSION_SECRET ??= "router-user-snapshot-unit-test-key";

test("router user snapshot payload is encrypted and round-trips on the server", () => {
  const payload = {
    version: 2 as const,
    routerId: 42,
    routerName: "come4",
    capturedAt: "2026-09-30T08:00:00.000Z",
    pppSecrets: [{
      id: "*1",
      name: "customer@example",
      password: "sensitive-ppp-password",
      service: "pppoe",
      profile: "default",
      localAddress: "",
      remoteAddress: "10.0.0.2",
      callerId: "",
      disabled: false,
      comment: "",
    }],
    hotspotUsers: [{
      id: "*2",
      name: "voucher-user",
      password: "sensitive-hotspot-password",
      profile: "default",
      comment: "",
      macAddress: "",
      server: "",
      disabled: false,
      limitUptime: "",
      limitBytesTotal: 0,
      bytesIn: 0,
      bytesOut: 0,
    }],
    pppProfiles: [{
      id: "*3",
      name: "default",
      localAddress: "",
      remoteAddress: "",
      rateLimit: "",
      sessionTimeout: "",
      idleTimeout: "",
      onlyOne: false,
      comment: "",
    }],
    hotspotProfiles: [{
      id: "*4",
      name: "default",
      rateLimit: "",
      sharedUsers: 1,
      sessionTimeout: "",
      idleTimeout: "",
      keepaliveTimeout: "",
      statusAutorefresh: "",
      macCookieTimeout: "",
      comment: "",
    }],
  };

  const encrypted = encodeRouterUserSnapshot(payload);
  const serializedCiphertext = JSON.stringify(encrypted);
  assert.equal(serializedCiphertext.includes("sensitive-ppp-password"), false);
  assert.equal(serializedCiphertext.includes("sensitive-hotspot-password"), false);
  assert.deepEqual(decodeRouterUserSnapshot(encrypted), payload);
});

test("oversized snapshots fail explicitly rather than truncating user data", () => {
  const payload = {
    version: 2 as const,
    routerId: 42,
    routerName: "come4",
    capturedAt: "2026-09-30T08:00:00.000Z",
    pppSecrets: [],
    hotspotUsers: [{
      id: "*2",
      name: "large-user",
      password: "x".repeat(6 * 1024 * 1024),
      profile: "default",
      comment: "",
      disabled: false,
      limitUptime: "",
      limitBytesTotal: 0,
      bytesIn: 0,
      bytesOut: 0,
    }],
    pppProfiles: [],
    hotspotProfiles: [],
  };
  assert.throws(() => encodeRouterUserSnapshot(payload), RouterUserSnapshotTooLargeError);
});

test("snapshot storage is tenant-scoped, opt-in, concurrency-safe, and in the deployment runner", async () => {
  const [migration, schemaSnapshot, runner] = await Promise.all([
    readFile(new URL("../../migrations/2026_router_user_snapshots.sql", import.meta.url), "utf8"),
    readFile(new URL("../../migrations/supabase_schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /schedule_enabled boolean not null default false/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.router_user_snapshots from anon, authenticated/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /r\.id = p_router_id and r\.admin_id = p_admin_id/i);
  assert.match(schemaSnapshot, /create table if not exists public\.router_user_snapshots/i);
  assert.match(schemaSnapshot, /claim_due_router_user_snapshots/i);
  assert.match(runner, /2026_router_user_snapshots\.sql/);
});

test("import metadata column is present in the base schema and deployment migration list", async () => {
  const [migration, schemaSnapshot, runner] = await Promise.all([
    readFile(new URL("../../migrations/2026_router_user_import_data.sql", import.meta.url), "utf8"),
    readFile(new URL("../../migrations/supabase_schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /add column if not exists router_import_data jsonb/i);
  assert.match(schemaSnapshot, /router_import_data jsonb/i);
  assert.match(runner, /2026_router_user_import_data\.sql/);
});