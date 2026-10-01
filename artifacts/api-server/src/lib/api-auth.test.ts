import assert from "node:assert/strict";
import test from "node:test";

process.env.SESSION_SECRET = "router-api-config-auth-test-secret";
process.env.VITE_SUPABASE_URL = "https://api-auth-test.supabase.co";
process.env.VITE_SUPABASE_KEY = "api-auth-test-key";

const {
  authenticatedAdminId,
  generateAdminSessionToken,
  generatePasswordSetupToken,
  generateToken,
  generateVlanHotspotPortalContextToken,
  requireAdmin,
  validateToken,
  validateVlanHotspotPortalContextToken,
} = await import("./api-auth.js");

type FakeRequest = {
  headers: Record<string, string>;
  query: Record<string, string>;
  originalUrl: string;
  authUser?: { type: "a" | "c" | "p"; uid: string; time: number };
};

function requestFor(token: string, headers: Record<string, string> = {}): FakeRequest {
  return {
    headers: {
      authorization: `Bearer ${token}`,
      host: "api.local",
      ...headers,
    },
    query: {},
    originalUrl: "/api/test",
  };
}

function responseFor() {
  let statusCode = 200;
  let body: unknown;
  return {
    response: {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(value: unknown) {
        body = value;
        return this;
      },
    },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
}

test("regular ISP admins can authenticate and remain tenant-scoped", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{
    id: 42,
    parent_id: null,
    subdomain: null,
    role: "isp_admin",
    is_active: true,
    auth_version: 1,
  }]), { status: 200, headers: { "Content-Type": "application/json" } });
  const req = requestFor(generateAdminSessionToken("42", 1));
  const output = responseFor();
  let continued = false;

  try {
    await requireAdmin()(req as never, output.response as never, () => {
      continued = true;
    });
    assert.equal(continued, true);
    assert.equal(authenticatedAdminId(req as never, 42), 42);
    assert.equal(authenticatedAdminId(req as never, 43), 0);
    assert.equal(output.statusCode, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("password reset versions invalidate existing administrator sessions", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{
    id: 42,
    parent_id: null,
    subdomain: null,
    role: "isp_admin",
    is_active: true,
    auth_version: 2,
  }]), { status: 200, headers: { "Content-Type": "application/json" } });
  const req = requestFor(generateAdminSessionToken("42", 1));
  const output = responseFor();
  let continued = false;

  try {
    await requireAdmin()(req as never, output.response as never, () => {
      continued = true;
    });
    assert.equal(continued, false);
    assert.equal(output.statusCode, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a legacy impersonation header cannot select an administrator account", async () => {
  const req = requestFor(generateToken("a", "superadmin"), {
    "x-impersonated-admin-id": "42",
  });
  const output = responseFor();
  let continued = false;

  await requireAdmin()(req as never, output.response as never, () => {
    continued = true;
  });

  assert.equal(continued, true);
  assert.equal(req.authUser?.uid, "superadmin");
  assert.equal(authenticatedAdminId(req as never, 42), 0);
  assert.equal(output.statusCode, 200);
});

test("admin and password-setup tokens bind to the current auth version", () => {
  const admin = validateToken(generateAdminSessionToken("42", 7));
  const setup = validateToken(generatePasswordSetupToken("42", 8));
  assert.equal(admin?.authVersion, 7);
  assert.equal(setup?.type, "p");
  assert.equal(setup?.authVersion, 8);
});

test("VLAN Hotspot portal context tokens are signed and purpose-bound", () => {
  const scope = { adminId: 7, resellerId: 19, routerId: 31, portId: 43 };
  const token = generateVlanHotspotPortalContextToken(scope);
  const validated = validateVlanHotspotPortalContextToken(token);

  assert.deepEqual(
    {
      adminId: validated?.adminId,
      resellerId: validated?.resellerId,
      routerId: validated?.routerId,
      portId: validated?.portId,
      purpose: validated?.purpose,
    },
    { ...scope, purpose: "vlan-hotspot-portal" },
  );

  const [encoded, signature] = token.split(".");
  const tamperedToken = `${encoded}.${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
  assert.equal(validateVlanHotspotPortalContextToken(tamperedToken), null);
});

test("VLAN Hotspot portal contexts require positive safe IDs", () => {
  assert.throws(
    () => generateVlanHotspotPortalContextToken({ adminId: 0, resellerId: 19, routerId: 31, portId: 43 }),
    /complete reseller VLAN portal scope/i,
  );
});