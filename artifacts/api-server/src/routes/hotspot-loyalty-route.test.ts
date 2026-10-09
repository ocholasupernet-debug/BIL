import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import loyaltyRouter, { hotspotLoyaltyOperations } from "./hotspot-loyalty-route.js";

test("device loyalty reads and redemption stay tied to the newest scoped MAC account", async t => {
  const original = { ...hotspotLoyaltyOperations };
  const originalSessionSecret = process.env.SESSION_SECRET;
  const originalTokenSigningSecret = process.env.TOKEN_SIGNING_SECRET;
  process.env.SESSION_SECRET = "hotspot-loyalty-route-test-session-secret";
  process.env.TOKEN_SIGNING_SECRET = "hotspot-loyalty-route-test-signing-secret";
  const mac = "AA:BB:CC:DD:EE:FF";
  const credentials = { username: "test-hotspot", password: "test-only-9X" };
  const phone = "254700000001";
  let plan = { id: 41, admin_id: 7, name: "Five", type: "hotspot", price: 5,
    router_id: 31, port_id: null, owner_reseller_id: null, is_active: true, client_can_purchase: true };
  let customer: Record<string, unknown> | null = { id: 2, admin_id: 7, phone, mac_address: mac, router_id: 31, port_id: null,
    status: "active", ...credentials };
  let balance = 5;
  let fraction = 0;
  let redemptionRule: number | null | undefined = 5;
  let failReads = false;
  let paidTransaction: Record<string, unknown> | null = null;
  let rememberedDeviceAuthorization = "";
  const reads: Array<{ table: string; query: string }> = [];
  const redemptions: Record<string, unknown>[] = [];
  hotspotLoyaltyOperations.select = async <T>(table: string, query: string): Promise<T[]> => {
    reads.push({ table, query });
    if (failReads) throw new Error("simulated database outage");
    const rows = table === "isp_plans" ? [plan]
      : table === "isp_routers" ? [{ id: 31 }]
      : table === "isp_reseller_router_ports" ? [{ assigned_reseller_id: 19 }]
      : table === "isp_customers" ? customer ? [customer] : []
      : table === "isp_loyalty_accounts" ? [{ points_balance: balance, fractional_balance: fraction }]
      : table === "isp_loyalty_settings" ? [{ kes_per_point: 10 }]
      : table === "isp_loyalty_plan_rules" ? redemptionRule === undefined
        ? [] : [{ plan_id: 41, redemption_points: redemptionRule, points_awarded: null }]
      : table === "isp_transactions" ? paidTransaction ? [paidTransaction] : []
      : [];
    return rows as T[];
  };
  hotspotLoyaltyOperations.redeem = async <T>(_name: string, params: Record<string, unknown>): Promise<T[]> => {
    redemptions.push(params);
    return [{ checkout_id: "LOYALTY-test", points_balance: 0, points_spent: 5 }] as T[];
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers["x-test-signed-portal"]) req.hotspotPortalContext = {
      purpose: "vlan-hotspot-portal", adminId: 7, resellerId: 19, routerId: 31,
      portId: 43, issuedAt: Math.floor(Date.now() / 1000), nonce: "test-only",
    };
    next();
  });
  app.use("/api", loyaltyRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const request = async (path: string, extra: Record<string, unknown> = {}, signed = false) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/hotspot/loyalty/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(signed ? { "x-test-signed-portal": "1" } : {}) },
      body: JSON.stringify({ adminId: 7, router_id: 31, mac_address: mac, ...extra }),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  try {
    await t.test("balance loads without a plan or phone and preserves fractional earnings", async () => {
      fraction = 0.5;
      const result = await request("balance", { mac_address: "aa-bb-cc-dd-ee-ff" });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, { ok: true, balance: 5.5, hasAccount: true });
      assert.ok(reads.some(row => row.table === "isp_customers" && row.query.includes("router_id=eq.31")
        && row.query.includes("admin_id=in.(7)") && row.query.includes("port_id=is.null")
        && row.query.includes("order=created_at.desc.nullslast,id.desc&limit=1")));
      fraction = 0;
    });
    await t.test("exactly five points offers a five-shilling package by default", async () => {
      const result = await request("quote", { plan_id: 41 });
      assert.equal(result.status, 200);
      assert.equal(result.body.balance, 5);
      assert.equal(result.body.canRedeem, true);
      assert.equal(result.body.pointsRequired, 5);
      assert.equal(result.body.pointsAwarded, 0.5);
    });
    await t.test("the package price sets the eligibility threshold when the balance is low", async () => {
      const originalPrice = plan.price;
      const originalRule = redemptionRule;
      plan = { ...plan, price: 10 };
      redemptionRule = undefined;
      balance = 8;
      const result = await request("quote", { plan_id: 41 });
      assert.equal(result.body.pointsRequired, 10);
      assert.equal(result.body.canRedeem, false);
      plan = { ...plan, price: originalPrice };
      redemptionRule = originalRule;
    });
    await t.test("an explicit plan cost overrides the price and zero disables redemption", async () => {
      const originalRule = redemptionRule;
      balance = 5;
      redemptionRule = 7;
      assert.equal((await request("quote", { plan_id: 41 })).body.canRedeem, false);
      balance = 7;
      assert.equal((await request("quote", { plan_id: 41 })).body.canRedeem, true);
      redemptionRule = 0;
      assert.equal((await request("quote", { plan_id: 41 })).body.canRedeem, false);
      redemptionRule = originalRule;
      balance = 5;
    });
    await t.test("insufficient balance does not offer redemption", async () => {
      balance = 4;
      assert.equal((await request("quote", { plan_id: 41 })).body.canRedeem, false);
      balance = 5;
    });
    await t.test("the scoped device MAC can redeem without credentials and submitted phone cannot choose the wallet", async () => {
      const result = await request("redeem", { plan_id: 41, phone: "254700000099",
        idempotency_key: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" });
      assert.equal(result.status, 200);
      assert.equal(typeof result.body.device_authorization, "string");
      assert.ok(Number(result.body.device_authorization_expires_at) > Date.now());
      rememberedDeviceAuthorization = String(result.body.device_authorization);
      assert.equal(redemptions.at(-1)?.p_phone, phone);
      assert.equal(redemptions.at(-1)?.p_mac_address, mac);
      assert.equal(redemptions.at(-1)?.p_idempotency_key, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
      assert.equal(reads.some(row => row.table === "isp_customers" && row.query.includes("password")), false,
        "MAC-only redemption must not read Hotspot passwords");
    });
    await t.test("a later redemption also works without a password or stored device token", async () => {
      const result = await request("redeem", {
        plan_id: 41,
        idempotency_key: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      });
      assert.equal(result.status, 200);
      assert.equal(typeof result.body.device_authorization, "string");
      const latestCustomerRead = reads.filter(row => row.table === "isp_customers").at(-1);
      assert.ok(latestCustomerRead);
      assert.ok(!latestCustomerRead.query.includes("password"), "MAC-only redemption must not fetch account passwords");
    });
    await t.test("unknown or cross-service device cannot see or spend another balance", async () => {
      const saved = customer;
      const before = redemptions.length;
      for (const value of [null, { ...saved, admin_id: 8 }, { ...saved, router_id: 32 },
        { ...saved, port_id: 44 }, { ...saved, mac_address: "11:22:33:44:55:66" }]) {
        customer = value;
        reads.length = 0;
        assert.deepEqual((await request("balance")).body, { ok: true, balance: 0, hasAccount: false });
        assert.equal((await request("quote", { plan_id: 41 })).body.canRedeem, false);
        assert.equal(reads.some(row => row.table === "isp_loyalty_accounts"), false);
        assert.equal((await request("redeem", { plan_id: 41,
          idempotency_key: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" })).status, 409);
      }
      assert.equal(redemptions.length, before);
      customer = saved;
    });
    await t.test("missing MAC and invalid service identifiers fail without account reads", async () => {
      reads.length = 0;
      assert.equal((await request("balance", { mac_address: "" })).status, 400);
      assert.equal((await request("balance", { router_id: -1 })).status, 400);
      assert.equal((await request("balance", { port_id: "not-a-port" })).status, 400);
      assert.equal((await request("quote", { mac_address: "", plan_id: 41 })).status, 400);
      assert.equal(reads.length, 0);
    });
    await t.test("signed reseller scope fixes tenant and port ownership", async () => {
      const saved = customer;
      customer = { ...saved, admin_id: 19, port_id: 43 };
      reads.length = 0;
      const result = await request("balance", { adminId: 999, port_id: 43 }, true);
      assert.equal(result.status, 200);
      assert.equal(result.body.balance, 5);
      assert.ok(reads.some(row => row.table === "isp_customers"
        && row.query.includes("admin_id=in.(7,19)") && row.query.includes("port_id=eq.43")));
      assert.ok(reads.some(row => row.table === "isp_loyalty_accounts" && row.query.includes("admin_id=eq.7")));
      assert.equal((await request("balance", { port_id: 44 }, true)).status, 404);
      customer = saved;
    });
    await t.test("a lost redemption response can recover its paid checkout even with zero points", async () => {
      const key = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
      paidTransaction = { admin_id: 7, plan_id: 41, payment_phone: phone, mac_address: mac,
        reference: `LOYALTY-${key}`, status: "completed" };
      balance = 0;
      const result = await request("quote", { plan_id: 41, idempotency_key: key, account_credentials: null });
      assert.equal(result.body.canRedeem, false);
      assert.equal(result.body.pendingCheckoutId, null, "a MAC and idempotency key alone must not recover an access capability");
      const verifiedRecovery = await request("quote", {
        plan_id: 41,
        idempotency_key: key,
        account_credentials: null,
        device_authorization: rememberedDeviceAuthorization,
      });
      assert.equal(verifiedRecovery.body.pendingCheckoutId, `LOYALTY-${key}`);
      assert.equal(typeof verifiedRecovery.body.device_authorization, "string");
      assert.equal(redemptions.length, 2, "recovering the reference must not debit points");
      paidTransaction.mac_address = "11:22:33:44:55:66";
      assert.equal((await request("quote", {
        plan_id: 41,
        idempotency_key: key,
        account_credentials: null,
        device_authorization: rememberedDeviceAuthorization,
      })).body.pendingCheckoutId, null);
      paidTransaction = null;
      balance = 5;
    });
    await t.test("MAC-only redemption still works when device-token signing is unavailable", async () => {
      const sessionSecret = process.env.SESSION_SECRET;
      const tokenSigningSecret = process.env.TOKEN_SIGNING_SECRET;
      delete process.env.SESSION_SECRET;
      delete process.env.TOKEN_SIGNING_SECRET;
      try {
        const result = await request("redeem", { plan_id: 41,
          idempotency_key: "eeeeeeee-bbbb-4ccc-8ddd-eeeeeeeeeeee" });
        assert.equal(result.status, 200);
        assert.equal(typeof result.body.device_authorization, "undefined");
        assert.equal(redemptions.at(-1)?.p_phone, phone);
      } finally {
        if (sessionSecret === undefined) delete process.env.SESSION_SECRET;
        else process.env.SESSION_SECRET = sessionSecret;
        if (tokenSigningSecret === undefined) delete process.env.TOKEN_SIGNING_SECRET;
        else process.env.TOKEN_SIGNING_SECRET = tokenSigningSecret;
      }
    });
    await t.test("disabled and suspended scoped accounts cannot redeem", async () => {
      const saved = customer;
      const before = redemptions.length;
      for (const status of ["suspended", "disabled"]) {
        customer = { ...saved, status };
        const result = await request("redeem", { plan_id: 41,
          idempotency_key: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" });
        assert.equal(result.status, 409);
        assert.equal(redemptions.length, before);
      }
      customer = saved;
    });
    await t.test("expired accounts may redeem a new entitlement, but suspended accounts may not", async () => {
      const saved = customer;
      customer = { ...saved, status: "expired" };
      assert.equal((await request("quote", { plan_id: 41,
        idempotency_key: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" })).status, 200);
      assert.equal((await request("redeem", { plan_id: 41,
        idempotency_key: "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee" })).status, 200);
      customer = { ...saved, status: "suspended" };
      assert.equal((await request("redeem", { plan_id: 41,
        idempotency_key: "dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee" })).status, 409);
      customer = saved;
    });
    await t.test("database failures are not presented as a zero balance", async () => {
      failReads = true;
      assert.equal((await request("balance")).status, 503);
      failReads = false;
    });
    await t.test("invalid idempotency keys are rejected before points are debited", async () => {
      const before = redemptions.length;
      assert.equal((await request("redeem", { plan_id: 41, idempotency_key: "not-a-uuid" })).status, 400);
      assert.equal(redemptions.length, before);
    });
  } finally {
    Object.assign(hotspotLoyaltyOperations, original);
    if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSessionSecret;
    if (originalTokenSigningSecret === undefined) delete process.env.TOKEN_SIGNING_SECRET;
    else process.env.TOKEN_SIGNING_SECRET = originalTokenSigningSecret;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
