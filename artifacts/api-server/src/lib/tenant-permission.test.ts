import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from "express";

const previousSupabaseUrl = process.env.VITE_SUPABASE_URL;
const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.VITE_SUPABASE_URL = "https://permission-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "permission-test-key";

const { requireTenantPermission } = await import("./tenant-permission.js");

if (previousSupabaseUrl === undefined) delete process.env.VITE_SUPABASE_URL;
else process.env.VITE_SUPABASE_URL = previousSupabaseUrl;
if (previousServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey;

const originalFetch = globalThis.fetch;
let permissionEnabled = false;
let fetchCount = 0;
globalThis.fetch = async (
  input: Parameters<typeof globalThis.fetch>[0],
): Promise<Awaited<ReturnType<typeof globalThis.fetch>>> => {
  fetchCount += 1;
  const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(rawUrl);
  if (url.pathname.endsWith("/isp_admins")) {
    return new Response(JSON.stringify([{ role: "isp_admin" }]), { status: 200 });
  }
  if (url.pathname.endsWith("/platform_role_permissions")) {
    return new Response(JSON.stringify(permissionEnabled ? [{ enabled: true }] : []), { status: 200 });
  }
  throw new Error(`Unexpected permission lookup: ${url.pathname}`);
};

after(() => {
  globalThis.fetch = originalFetch;
});

async function authorize(uid: string, permission = "Manage Gateways"): Promise<{
  status: number | undefined;
  body: { ok?: boolean; error?: string } | undefined;
  proceeded: boolean;
}> {
  const req = { authUser: { type: "a", uid, time: 1 } } as unknown as ExpressRequest;
  let status: number | undefined;
  let body: { ok?: boolean; error?: string } | undefined;
  let proceeded = false;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: { ok?: boolean; error?: string }) {
      body = payload;
      return this;
    },
  } as unknown as ExpressResponse;

  await requireTenantPermission(permission)(
    req,
    res,
    (() => { proceeded = true; }) as NextFunction,
  );
  return { status, body, proceeded };
}

test("tenant permission middleware denies gateway access when Super Admin has not enabled it", async () => {
  permissionEnabled = false;
  fetchCount = 0;
  const result = await authorize("42");
  assert.equal(result.status, 403);
  assert.match(result.body?.error ?? "", /Manage Gateways/);
  assert.equal(result.proceeded, false);
  assert.equal(fetchCount, 2);
});

test("tenant permission middleware allows gateway access when enabled for the account role", async () => {
  permissionEnabled = true;
  fetchCount = 0;
  const result = await authorize("42");
  assert.equal(result.status, undefined);
  assert.equal(result.proceeded, true);
  assert.equal(fetchCount, 2);
});

test("a Super Admin session retains full permission access without a tenant lookup", async () => {
  permissionEnabled = false;
  fetchCount = 0;
  const result = await authorize("superadmin");
  assert.equal(result.proceeded, true);
  assert.equal(fetchCount, 0);
});

test("a Super Admin session does not bypass unrelated tenant permissions", async () => {
  fetchCount = 0;
  const result = await authorize("superadmin", "View Settings");
  assert.equal(result.status, 403);
  assert.equal(result.proceeded, false);
  assert.equal(fetchCount, 0);
});