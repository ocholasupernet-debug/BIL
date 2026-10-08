import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createAdminSessionToken } from "../portal-refresh-token.mjs";

test("signs a portal refresh token with the tenant's current auth version", () => {
  const signingSecret = "test-signing-secret";
  const token = createAdminSessionToken({
    adminId: 33,
    authVersion: 2,
    issuedAt: 1_791_460_000,
    signingSecret,
  });
  const parts = token.split(".");

  assert.equal(parts.length, 5);
  assert.equal(parts[0], "a");
  assert.equal(parts[1], "33");
  assert.equal(JSON.parse(Buffer.from(parts[3].slice(1), "base64url").toString("utf8")).authVersion, 2);
  assert.equal(
    parts[4],
    createHmac("sha256", signingSecret).update(parts.slice(0, -1).join(".")).digest("hex"),
  );
});

test("rejects missing or invalid tenant auth versions", () => {
  assert.throws(
    () => createAdminSessionToken({ adminId: 33, issuedAt: 1_791_460_000, signingSecret: "secret" }),
    /current tenant auth version is required/,
  );
  assert.throws(
    () => createAdminSessionToken({ adminId: 33, authVersion: 0, issuedAt: 1_791_460_000, signingSecret: "secret" }),
    /current tenant auth version is required/,
  );
});
