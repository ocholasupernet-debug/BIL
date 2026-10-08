import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { syncActiveAccountsToRouter } from "./prepaid-sync";

const router = { id: 7, name: "Test router" };
const plans = [{ id: 2, name: "3 hours", router_id: 7 }];
const account = (id: number) => ({
  id, username: `account-${id}`, password: "not-a-real-password",
  type: "hotspot", status: "active", plan_id: 2, router_id: 7,
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
});
type Payload = { activeOnly: boolean; users: ReturnType<typeof account>[] & { customer_id: number }[] };
const base = { router, plans, endpoint: "/test-sync", adminId: 8, token: "" };
const responseFor = (payload: Payload) => Response.json({
  ok: true,
  syncResults: payload.users.map(user => ({
    customerId: user.customer_id, username: user.username,
    planName: "3 hours", serviceType: user.type, routerName: router.name,
    outcome: "synced",
  })),
});

test("sync sends only entitled accounts on the selected router and removes duplicate IDs", async () => {
  const bodies: Payload[] = [];
  const users = [
    account(1), account(1),
    { ...account(2), status: "expired" }, // A future expiry repairs a stale label.
    { ...account(3), expires_at: new Date(Date.now() - 1000).toISOString() },
    { ...account(4), status: "suspended" },
    { ...account(5), depletion_reason: "data_limit" },
    { ...account(6), router_id: 9 },
    { ...account(7), type: "vlan" },
    { ...account(8), status: "pending" },
  ];
  const result = await syncActiveAccountsToRouter({
    ...base, users,
    request: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as Payload;
      bodies.push(payload);
      return responseFor(payload);
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(bodies[0].users.map(user => user.customer_id), [1, 2]);
  assert.equal(bodies[0].activeOnly, true);
  assert.equal(result.users.length, 2);
});

test("bounded requests produce one complete report, including offline-but-confirmed accounts", async () => {
  let requests = 0;
  const progress: number[] = [];
  const result = await syncActiveAccountsToRouter({
    ...base, users: Array.from({ length: 12 }, (_, i) => account(i + 1)),
    onProgress: (_total, processed) => progress.push(processed),
    request: async (_url, init) => {
      requests++;
      const payload = JSON.parse(String(init?.body)) as Payload;
      assert.ok(payload.users.length <= 5);
      // No active session is needed to report an enabled, verified account as synced.
      return responseFor(payload);
    },
  });
  assert.equal(requests, 3);
  assert.equal(result.ok, true);
  assert.equal(result.total, 12);
  assert.equal(result.processed, 12);
  assert.equal(result.users.filter(row => row.outcome === "synced").length, 12);
  assert.deepEqual(progress, [0, 5, 10, 12]);
  assert.ok(result.users.every(row => row.planName && row.serviceType && row.routerName));
});

test("a partial interrupted response keeps confirmed users and does not retry unknown changes", async () => {
  let requests = 0;
  const result = await syncActiveAccountsToRouter({
    ...base, users: Array.from({ length: 7 }, (_, i) => account(i + 1)),
    request: async () => {
      requests++;
      return Response.json({
        ok: false, error: "Router connection interrupted",
        syncResults: [{
          customerId: 1, username: "account-1", planName: "3 hours",
          serviceType: "hotspot", routerName: router.name, outcome: "synced",
        }],
      });
    },
  });
  assert.equal(requests, 1);
  assert.equal(result.ok, false);
  assert.equal(result.users.length, 7);
  assert.equal(result.users.filter(row => row.outcome === "synced").length, 1);
  assert.equal(result.users.filter(row => row.outcome === "unknown").length, 6);
  assert.match(result.error || "", /interrupted/);
});

test("missing or mismatched router confirmations never become a successful sync", async () => {
  const result = await syncActiveAccountsToRouter({
    ...base, users: [account(1)],
    request: async () => Response.json({
      ok: true,
      syncResults: [{ customerId: 1, username: "someone-else", outcome: "synced" }],
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.users[0].outcome, "unknown");
});

test("no active accounts produces an empty report without calling MikroTik", async () => {
  const result = await syncActiveAccountsToRouter({
    ...base, users: [{ ...account(1), status: "suspended" }],
    request: async () => { throw new Error("must not request"); },
  });
  assert.equal(result.total, 0);
  assert.deepEqual(result.users, []);
});

test("the API gates active-only sync before inactive router mutations and reports account confirmation", () => {
  const route = readFileSync(new URL("../../../api-server/src/routes/sync-route.ts", import.meta.url), "utf8");
  const start = route.indexOf('router.post("/admin/sync/users"');
  const source = route.slice(start, route.indexOf("/*", route.indexOf("res.json({ ok: false, error: connErr", start)));
  assert.notEqual(source.indexOf("activeOnly === true && !enabled"), -1);
  assert.notEqual(source.indexOf("const accountPath = isHotspotUser"), -1);
  assert.ok(source.indexOf("activeOnly === true && !enabled") < source.indexOf("const accountPath = isHotspotUser"));
  assert.match(source, /storedRadiusUsername !== username/);
  assert.match(source, /result\.confirmedActive && enabled \? "synced"/);
  assert.match(source, /syncResults,/);
});
