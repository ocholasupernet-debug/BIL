import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const portal = readFileSync(new URL("../../public/hotspot/login.html", import.meta.url), "utf8");
const helpers = portal.slice(
  portal.indexOf("function formatPortalLoyaltyPoints("),
  portal.indexOf("function isSupportedPaymentGateway("),
);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

type Responder = (path: string, body: Record<string, unknown>) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;
function fixture(responder?: Responder) {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const title = { textContent: "", style: {} };
  const status = { textContent: "", style: {} };
  const nodes: Record<string, typeof title> = { loyaltyPointsTitle: title, loyaltyPointsStatus: status };
  const state = { balance: 5, hasAccount: true, canRedeem: true, pointsRequired: 5 };
  const intervals: Array<{ callback: () => void; ms: number }> = [];
  const context = vm.createContext({
    PORTAL_ADMIN_ID: 7, PORTAL_ROUTER_ID: 31, PORTAL_PORT_ID: 0,
    PORTAL_DEVICE_MAC: "AA:BB:CC:DD:EE:FF", PORTAL_PREVIEW_ONLY: false,
    portalLoyaltyBusy: false, portalLoyaltyRequestId: 0,
    selectedPlan: null, tvPurchase: false, stkPhone: "",
    stkState: "idle", window: { crypto: { randomUUID: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" } },
    document: { hidden: false, getElementById: (id: string) => nodes[id] ?? null },
    portalCardEnabled: () => true, apiUrl: (path: string) => path,
    renderModal: () => {}, canStartPaymentCheckout: () => true,
    setTimeout, clearTimeout, AbortController,
    setInterval: (callback: () => void, ms: number) => { intervals.push({ callback, ms }); return intervals.length; },
    clearInterval: () => {},
    portalPaymentRequest: async (path: string, body: Record<string, unknown>) => {
      requests.push({ path, body });
      const r = await responder!(path, body);
      return { ok: r.ok, status: r.status, data: await r.json() };
    },
    assignPaidHotspotAccess: async () => {},
    escapePortalText: (value: string) => value,
    loadPortalLoyaltyBalance: () => {},
    fetch: async (path: string, options: { body: string }) => {
      requests.push({ path, body: JSON.parse(options.body) });
      if (responder) return responder(path, JSON.parse(options.body));
      return { ok: true, json: async () => ({ ok: true, ...state, pointsAwarded: 0.5, pendingCheckoutId: null }) };
    },
  });
  vm.runInContext(helpers, context);
  return { context, requests, title, status, state, intervals };
}

test("RouterOS loyalty card automatically loads the MAC balance without a phone or package", async () => {
  const f = fixture();
  f.context.startPortalLoyaltyBalance();
  await tick();
  assert.equal(f.title.textContent, "5 points");
  assert.equal(f.requests[0].path, "/api/hotspot/loyalty/balance");
  assert.deepEqual(f.requests[0].body, {
    adminId: 7, router_id: 31, mac_address: "AA:BB:CC:DD:EE:FF",
  });
  assert.equal(f.intervals[0].ms, 30000);
  f.state.hasAccount = false;
  f.state.balance = 99; // An unlinked device must not inherit a supplied account balance.
  f.intervals[0].callback();
  await tick();
  assert.equal(f.title.textContent, "0 points");
});

test("RouterOS package points choice follows eligibility and does not require a phone", async () => {
  const f = fixture();
  f.context.selectedPlan = { id: 41, name: "Five", price: 5 };
  f.context.loadLoyaltyQuoteForPlan();
  await tick();
  assert.equal(f.context.loyaltyRedeemable(), true);
  f.context.setLoyaltyMode("points");
  assert.equal(f.context.loyaltyEffectiveMode(), "points");
  assert.equal(f.requests[0].body.plan_id, 41);
  assert.equal("phone" in f.requests[0].body, false);
  f.state.canRedeem = false;
  f.state.balance = 4;
  f.context.loadLoyaltyQuoteForPlan();
  await tick();
  assert.equal(f.context.loyaltyRedeemable(), false);
  assert.equal(f.context.loyaltyEffectiveMode(), "mpesa");
});

test("RouterOS points are not shown for an unidentified device", () => {
  const f = fixture();
  f.context.PORTAL_DEVICE_MAC = "";
  f.context.loadPortalLoyaltyBalance();
  assert.equal(f.title.textContent, "Device not identified");
  assert.equal(f.requests.length, 0);
});

const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const eligible = { ok: true, balance: 5, pointsRequired: 5, pointsAwarded: 0, canRedeem: true, pendingCheckoutId: null };

test("RouterOS quote 401 clears bad proof and refreshes public eligibility once with the same nonce", async () => {
  const f = fixture(async (_path, body) => body.account_credentials
    ? reply(401, { verificationRequired: true, error: "Verification required" })
    : reply(200, eligible));
  f.context.selectedPlan = { id: 41, name: "Five", price: 5 };
  f.context.loyCreds = { username: "bad", password: "wrong" };
  f.context.loyKeys[f.context.loyaltyAttemptId(41)] = "nonce-1";
  f.context.loadLoyaltyQuoteForPlan();
  await tick(); await tick();
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests[0].body.account_credentials);
  assert.equal("account_credentials" in f.requests[1].body, false);
  assert.equal(f.requests[1].body.idempotency_key, "nonce-1");
  assert.equal(f.context.loyCreds, null);
  assert.equal(f.context.loyaltyRedeemable(), true);
  assert.equal(f.context.loyaltyNeedsConfirm(), true);
});

test("RouterOS network or non-JSON redeem errors stay in points mode and retry with the same key", async () => {
  let redeemCalls = 0;
  const f = fixture(async path => {
    if (path.endsWith("/redeem")) { redeemCalls++; throw new Error("network"); }
    return reply(200, eligible);
  });
  f.context.selectedPlan = { id: 41, name: "Five", price: 5 };
  f.context.loyCreds = { username: "ann", password: "pw" };
  f.context.loadLoyaltyQuoteForPlan();
  await tick();
  f.context.redeemLoyaltyPoints(); await tick(); await tick();
  assert.equal(f.context.loyaltyEffectiveMode(), "points");
  // Even if eligibility later reads as unavailable, an uncertain debit must not offer M-Pesa.
  f.context.loyQuote = { balance: 0, pointsRequired: 5, pointsAwarded: 0, canRedeem: false };
  assert.equal(f.context.loyaltyEffectiveMode(), "points");
  f.context.loyQuote = { balance: 5, pointsRequired: 5, pointsAwarded: 0, canRedeem: true };
  f.context.redeemLoyaltyPoints(); await tick(); await tick();
  const redeems = f.requests.filter(r => r.path.endsWith("/redeem"));
  assert.equal(redeemCalls, 2);
  assert.equal(redeems[0].body.idempotency_key, redeems[1].body.idempotency_key);
});

test("RouterOS redeem 401 with wrong or malformed proof prompts for correction without validating on input", async () => {
  const f = fixture(async path => path.endsWith("/redeem")
    ? reply(401, { verificationRequired: true, error: "Verification required" })
    : reply(200, eligible));
  f.context.selectedPlan = { id: 41, name: "Five", price: 5 };
  f.context.loyCreds = { username: "x", password: "y" };
  f.context.loadLoyaltyQuoteForPlan();
  await tick();
  f.context.redeemLoyaltyPoints(); await tick(); await tick();
  assert.equal(f.context.loyCreds, null);
  assert.equal(f.context.loyaltyNeedsConfirm(), true);
  assert.match(f.context.loyConfirmNotice, /could not confirm/);
  assert.equal(f.requests.filter(r => r.path.endsWith("/redeem")).length, 1);
  // No further requests happen until the user submits again.
  await tick();
  assert.equal(f.requests.filter(r => r.path.endsWith("/redeem")).length, 1);
  assert.equal(f.context.loyaltyEffectiveMode(), "mpesa");
});
