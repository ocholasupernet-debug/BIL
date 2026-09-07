import assert from "node:assert/strict";
import test from "node:test";

process.env.SESSION_SECRET = "router-api-config-auth-test-secret";

const {
  authenticatedAdminId,
  generateToken,
  requireAdmin,
} = await import("./api-auth.js");

type FakeRequest = {
  headers: Record<string, string>;
  query: Record<string, string>;
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
  const req = requestFor(generateToken("a", "42"));
  const output = responseFor();
  let continued = false;

  await requireAdmin()(req as never, output.response as never, () => {
    continued = true;
  });

  assert.equal(continued, true);
  assert.equal(authenticatedAdminId(req as never, 42), 42);
  assert.equal(authenticatedAdminId(req as never, 43), 0);
  assert.equal(output.statusCode, 200);
});

test("superadmin impersonation selects only the validated tenant", async () => {
  const req = requestFor(generateToken("a", "superadmin"), {
    "x-impersonated-admin-id": "42",
  });
  const output = responseFor();
  let continued = false;

  await requireAdmin()(req as never, output.response as never, () => {
    continued = true;
  });

  assert.equal(continued, true);
  assert.equal(req.authUser?.uid, "42");
  assert.equal(authenticatedAdminId(req as never, 42), 42);
  assert.equal(authenticatedAdminId(req as never, 43), 0);
  assert.equal(output.statusCode, 200);
});