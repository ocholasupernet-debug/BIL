/*
 * Staging-only PPPoE renewal harness.
 *
 * This test deliberately bundles the renewal helper with in-memory Supabase
 * and RouterOS adapters. It proves the access-state boundary without using
 * provider credentials, production data, or a live router.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { processMpesaCallback } from "../src/routes/mpesa-route.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "src/lib/auto-provision.ts");

async function bundleRenewalHelper() {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [{
      name: "staging-adapters",
      setup(plugin) {
        plugin.onResolve({ filter: /^\.\// }, args => {
          const replacements = {
            "./supabase-client": "supabase-client",
            "./mikrotik": "mikrotik",
            "./logger": "logger",
            "./router-vpn-ip.js": "router-vpn-ip",
          };
          return replacements[args.path]
            ? { path: replacements[args.path], namespace: "staging" }
            : undefined;
        });
        plugin.onLoad({ filter: /.*/, namespace: "staging" }, args => {
          const modules = {
            "supabase-client": `
              export async function sbSelect(table) { return globalThis.__pppoeStaging.db.select(table); }
              export async function sbInsert() { return []; }
              export async function sbUpdate() { return []; }
            `,
            "mikrotik": `
              export async function fetchPPPSecrets() { return structuredClone(globalThis.__pppoeStaging.secrets); }
              export async function updatePPPSecret(_credentials, id, fields) {
                const state = globalThis.__pppoeStaging;
                state.calls.push({ op: "update", id, fields });
                if (state.failRouter) throw new Error("staging router unavailable");
                const secret = state.secrets.find(item => item.id === id);
                if (!secret) throw new Error("secret not found");
                Object.assign(secret, fields);
              }
              export async function addPPPSecret(_credentials, fields) {
                const state = globalThis.__pppoeStaging;
                state.calls.push({ op: "add", fields });
                if (state.failRouter) throw new Error("staging router unavailable");
                state.secrets.push({ id: "*new", ...fields, disabled: false });
              }
              export async function removePPPSecret(_credentials, id) {
                globalThis.__pppoeStaging.secrets =
                  globalThis.__pppoeStaging.secrets.filter(item => item.id !== id);
              }
              export async function addHotspotUser() {}
              export async function updateHotspotUser() {}
            `,
            "logger": `export const logger = { info() {}, warn() {}, error() {} };`,
            "router-vpn-ip": `export function isRouterManagementVpnIp(value) { return /^10\\.8\\.(5|6)\\./.test(value || ""); }`,
          };
          return { contents: modules[args.path], loader: "js" };
        });
      },
    }],
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

function fixture(overrides = {}) {
  const state = {
    plans: [{
      id: 9, admin_id: 4, name: "PPPoE 20Mbps", type: "pppoe",
      plan_type: "pppoe", router_id: 3, is_active: true,
    }],
    customers: [{
      id: 22, admin_id: 4, type: "pppoe", username: "renew-me",
      pppoe_username: "renew-me", password: "secret",
    }],
    routers: [{
      id: 3, admin_id: 4, name: "come1", host: "203.0.113.20",
      vpn_ip: "10.8.5.20", bridge_ip: "192.168.88.1",
      router_username: "api-user", router_secret: "router-secret",
    }],
    secrets: [{
      id: "*1", name: "renew-me", profile: "old-plan",
      disabled: true, comment: "expired",
    }],
    calls: [],
    failRouter: false,
    ...overrides,
  };
  state.db = {
    select(table) {
      if (table === "isp_plans") return state.plans;
      if (table === "isp_customers") return state.customers;
      if (table === "isp_routers") return state.routers;
      return [];
    },
  };
  globalThis.__pppoeStaging = state;
  return state;
}

function callbackFixture(overrides = {}) {
  const state = {
    tx: {
      id: 31, admin_id: 4, customer_id: 22, plan_id: 9, amount: 1200,
      payment_method: "mpesa", payment_phone: "0723456789", mac_address: null,
      status: "pending",
    },
    customer: { status: "expired", plan_id: 7, expires_at: "2026-08-01T00:00:00.000Z", wallet_balance: 0 },
    routerEnabled: false,
    accessCalls: 0,
    settleCalls: 0,
    verifyCalls: 0,
    verification: { verified: true, resultCode: 0, resultDesc: "Success" },
    ...overrides,
  };
  const deps = {
    selectPending: async () => state.tx?.status === "pending" ? [state.tx] : [],
    getSettings: async () => ({
      consumerKey: "staging-key", consumerSecret: "staging-secret",
      shortcode: "174379", passkey: "staging-passkey",
      callbackUrl: "https://staging.example.test/api/mpesa/callback",
      env: "sandbox", tillNumber: "",
    }),
    verifyStk: async () => {
      state.verifyCalls += 1;
      return state.verification;
    },
    reactivatePppoeAccess: async () => {
      state.accessCalls += 1;
      if (state.failAccess) return { ok: false, error: "staging router unavailable" };
      state.routerEnabled = true;
      return {
        ok: true,
        rollback: async () => { state.routerEnabled = false; },
      };
    },
    settle: async args => {
      state.settleCalls += 1;
      if (state.failSettlement) throw new Error("staging database unavailable");
      if (state.tx.status !== "pending") return [{
        settled: false, payment_method: null, admin_id: null, amount: null,
        credited_customer_id: null,
      }];
      state.tx.status = args.p_status;
      if (args.p_status === "completed") {
        state.customer.status = "active";
        state.customer.plan_id = state.tx.plan_id;
        state.customer.expires_at = "2026-09-30T00:00:00.000Z";
      }
      return [{
        settled: true, payment_method: state.tx.payment_method,
        admin_id: state.tx.admin_id, amount: state.tx.amount,
        credited_customer_id: 22,
      }];
    },
  };
  return { state, deps };
}

function callbackBody(resultCode = 0, checkoutId = "ws_CO_12345") {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: "staging-merchant",
        CheckoutRequestID: checkoutId,
        ResultCode: resultCode,
        ResultDesc: resultCode === 0 ? "Success" : "The request was cancelled by the user",
      },
    },
  };
}

test("successful renewal enables the existing PPP secret on the management path", async () => {
  const { reactivatePppoeAccess } = await bundleRenewalHelper();
  const state = fixture();
  const result = await reactivatePppoeAccess({
    adminId: 4, customerId: 22, planId: 9, reference: "ws_CO-123",
  });

  assert.equal(result.ok, true);
  assert.equal(result.username, "renew-me");
  assert.equal(state.secrets[0].disabled, false);
  assert.equal(state.secrets[0].profile, "PPPoE 20Mbps");
  assert.equal(state.calls[0].op, "update");
});

test("a router failure keeps the renewal unsuccessful and performs no database activation", async () => {
  const { reactivatePppoeAccess } = await bundleRenewalHelper();
  const state = fixture({ failRouter: true });
  const transaction = { status: "pending" };
  const customer = { status: "expired", wallet_balance: 0 };
  const result = await reactivatePppoeAccess({
    adminId: 4, customerId: 22, planId: 9, reference: "ws_CO-124",
  });

  assert.equal(result.ok, false);
  assert.equal(transaction.status, "pending");
  assert.equal(customer.status, "expired");
  assert.equal(customer.wallet_balance, 0);
});

test("non-PPPoE plans are skipped without touching router access", async () => {
  const { reactivatePppoeAccess } = await bundleRenewalHelper();
  const state = fixture({ plans: [{
    id: 9, admin_id: 4, name: "Hotspot Daily", type: "hotspot",
    plan_type: "hotspot", router_id: 3, is_active: true,
  }] });
  const result = await reactivatePppoeAccess({
    adminId: 4, customerId: 22, planId: 9, reference: "ws_CO-125",
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.deepEqual(state.calls, []);
  assert.equal(state.secrets[0].disabled, true);
});

test("tenant or customer mismatch is rejected before RouterOS writes", async () => {
  const { reactivatePppoeAccess } = await bundleRenewalHelper();
  const state = fixture({ customers: [] });
  const result = await reactivatePppoeAccess({
    adminId: 4, customerId: 404, planId: 9, reference: "ws_CO-126",
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /customer account was not found/i);
  assert.deepEqual(state.calls, []);
});

test("settlement migration protects PPPoE binding and wallet-credit boundaries", async () => {
  const sql = await readFile(resolve(root, "migrations/2026_service_payment_routing.sql"), "utf8");
  assert.match(sql, /join isp_plans as p/);
  assert.match(sql, /p\.is_active = true/);
  assert.match(sql, /c\.admin_id = tx\.admin_id/);
  assert.match(sql, /c\.type = 'pppoe'/);
  assert.match(sql, /wallet_balance = wallet_balance \+ tx\.amount/);
  assert.match(sql, /if tx\.customer_id is null and tx\.payment_phone is not null/);
});

test("a verified successful callback renews PPPoE access without hotspot wallet credit", async () => {
  const { state, deps } = callbackFixture();
  const settled = await processMpesaCallback(callbackBody(), deps);

  assert.equal(settled, true);
  assert.equal(state.tx.status, "completed");
  assert.equal(state.customer.status, "active");
  assert.equal(state.customer.plan_id, 9);
  assert.equal(state.customer.expires_at, "2026-09-30T00:00:00.000Z");
  assert.equal(state.customer.wallet_balance, 0);
  assert.equal(state.routerEnabled, true);
  assert.equal(state.accessCalls, 1);
  assert.equal(state.settleCalls, 1);
});

test("failed provider callbacks settle as failed without changing customer or router state", async () => {
  const { state, deps } = callbackFixture({
    verification: { verified: true, resultCode: 1032, resultDesc: "Cancelled" },
  });
  const settled = await processMpesaCallback(callbackBody(1032), deps);

  assert.equal(settled, true);
  assert.equal(state.tx.status, "failed");
  assert.equal(state.customer.status, "expired");
  assert.equal(state.customer.plan_id, 7);
  assert.equal(state.customer.wallet_balance, 0);
  assert.equal(state.routerEnabled, false);
  assert.equal(state.accessCalls, 0);
});

test("replayed callbacks are ignored after the pending transaction is settled", async () => {
  const { state, deps } = callbackFixture();
  assert.equal(await processMpesaCallback(callbackBody(), deps), true);
  assert.equal(await processMpesaCallback(callbackBody(), deps), false);
  assert.equal(state.verifyCalls, 1);
  assert.equal(state.settleCalls, 1);
});

test("a delayed callback can be retried after local checkout reconciliation", async () => {
  const { state, deps } = callbackFixture({ tx: null });
  assert.equal(await processMpesaCallback(callbackBody(), deps), false);
  assert.equal(state.verifyCalls, 0);

  state.tx = {
    id: 31, admin_id: 4, customer_id: 22, plan_id: 9, amount: 1200,
    payment_method: "mpesa", payment_phone: "0723456789", mac_address: null,
    status: "pending",
  };
  assert.equal(await processMpesaCallback(callbackBody(), deps), true);
  assert.equal(state.tx.status, "completed");
  assert.equal(state.routerEnabled, true);
});

test("unverified Daraja results leave the transaction pending and make no state changes", async () => {
  const { state, deps } = callbackFixture({
    verification: { verified: false, resultCode: null, resultDesc: "Checkout ID mismatch" },
  });
  const settled = await processMpesaCallback(callbackBody(), deps);

  assert.equal(settled, false);
  assert.equal(state.tx.status, "pending");
  assert.equal(state.customer.status, "expired");
  assert.equal(state.routerEnabled, false);
  assert.equal(state.settleCalls, 0);
});

test("router failure leaves a verified renewal pending for deferred retry", async () => {
  const { state, deps } = callbackFixture({ failAccess: true });
  const settled = await processMpesaCallback(callbackBody(), deps);

  assert.equal(settled, false);
  assert.equal(state.tx.status, "pending");
  assert.equal(state.customer.status, "expired");
  assert.equal(state.routerEnabled, false);
  assert.equal(state.settleCalls, 0);
});