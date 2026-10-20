import assert from "node:assert/strict";
import test from "node:test";
import { runVerifiedApiCredentialRotation } from "./router-api-credential-rotation.js";

test("persists only after the replacement login verifies", async () => {
  const calls: string[] = [];
  const result = await runVerifiedApiCredentialRotation({
    async createTemporaryAccount() {
      calls.push("create");
      return "new-account-id";
    },
    async verifyNewLogin() {
      calls.push("verify");
      return "10.8.5.22";
    },
    async persistCredential() {
      calls.push("persist");
    },
    async removeTemporaryAccount() {
      calls.push("remove");
    },
  });

  assert.equal(result, "10.8.5.22");
  assert.deepEqual(calls, ["create", "verify", "persist"]);
});

test("removes the temporary account when the new login fails", async () => {
  const calls: string[] = [];

  await assert.rejects(
    runVerifiedApiCredentialRotation({
      async createTemporaryAccount() {
        calls.push("create");
        return "new-account-id";
      },
      async verifyNewLogin() {
        calls.push("verify");
        throw new Error("RouterOS rejected the new login");
      },
      async persistCredential() {
        calls.push("persist");
      },
      async removeTemporaryAccount(accountId) {
        calls.push(`remove:${accountId}`);
      },
    }),
    /Existing router credentials were not intentionally changed/,
  );

  assert.deepEqual(calls, ["create", "verify", "remove:new-account-id"]);
});

test("removes the temporary account when saving the credential fails", async () => {
  const calls: string[] = [];

  await assert.rejects(
    runVerifiedApiCredentialRotation({
      async createTemporaryAccount() {
        calls.push("create");
        return "new-account-id";
      },
      async verifyNewLogin() {
        calls.push("verify");
        return undefined;
      },
      async persistCredential() {
        calls.push("persist");
        throw new Error("Database write failed");
      },
      async removeTemporaryAccount(accountId) {
        calls.push(`remove:${accountId}`);
      },
    }),
    /Existing router credentials were not intentionally changed/,
  );

  assert.deepEqual(calls, ["create", "verify", "persist", "remove:new-account-id"]);
});

test("reports when cleanup of an uncommitted account cannot be confirmed", async () => {
  await assert.rejects(
    runVerifiedApiCredentialRotation({
      async createTemporaryAccount() {
        return "new-account-id";
      },
      async verifyNewLogin() {
        throw new Error("Verification failed");
      },
      async persistCredential() {},
      async removeTemporaryAccount() {
        throw new Error("Removal failed");
      },
    }),
    /cleanup could not be confirmed/,
  );
});
