import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const template = await readFile(
  resolve(import.meta.dirname, "../../ochola-supernet/public/hotspot/login.html"), "utf8",
);
const checkoutScript = template.slice(
  template.indexOf("function portalPaymentRequest("),
  template.indexOf("function closeTvModal("),
);
assert.ok(checkoutScript.includes("function sendStk()"));
const packageVisibilityScript = template.slice(
  template.indexOf("function shouldHidePackageSection("),
  template.indexOf("function applyPortalConfig("),
);
const checkoutReadinessScript = template.slice(
  template.indexOf("function canStartPaymentCheckout("),
  template.indexOf("function paymentGatewayLabel("),
);
const promptConfigScript = template.slice(
  template.indexOf("function portalMpesaPromptEnabled("),
  template.indexOf("function canStartPaymentCheckout("),
);
const portalConfigScript = template.slice(
  template.indexOf("function applyPortalConfig("),
  template.indexOf("function applyPortalTypography("),
);

test("maintenance can keep come3 packages visible without bypassing checkout readiness", () => {
  assert.ok(packageVisibilityScript.includes("function shouldHidePackageSection"));
  assert.match(portalConfigScript, /MPESA_PROMPT_ENABLED=portalMpesaPromptEnabled\(data\)/);
  let packageCardVisible = true;
  const context = {
    portalCardEnabled: () => packageCardVisible,
    MPESA_PROMPT_ENABLED: false,
    PAYMENT_STATUS_LOADED: true,
    PAYMENT_METHOD_READY: true,
    PORTAL_PREVIEW_ONLY: false,
  };
  vm.createContext(context);
  vm.runInContext(packageVisibilityScript, context);
  vm.runInContext(checkoutReadinessScript, context);

  assert.equal(vm.runInContext("shouldHidePackageSection(false)", context), false);
  assert.equal(vm.runInContext("shouldHidePackageSection(true)", context), true);
  assert.equal(vm.runInContext("shouldHidePackageSection(true, true)", context), false);
  packageCardVisible = false;
  assert.equal(vm.runInContext("shouldHidePackageSection(true, true)", context), true);
  assert.equal(vm.runInContext("canStartPaymentCheckout()", context), false);
  context.MPESA_PROMPT_ENABLED = true;
  context.PAYMENT_METHOD_READY = false;
  assert.equal(vm.runInContext("canStartPaymentCheckout()", context), false);
  context.PAYMENT_METHOD_READY = true;
  assert.equal(vm.runInContext("canStartPaymentCheckout()", context), true);
  context.PORTAL_PREVIEW_ONLY = true;
  assert.equal(vm.runInContext("canStartPaymentCheckout()", context), false);
});

test("portal prompt setting accepts the legacy Enable value and respects explicit booleans", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(promptConfigScript, context);

  assert.equal(vm.runInContext('portalMpesaPromptEnabled({mpesaPrompt: "Enable"})', context), true);
  assert.equal(vm.runInContext('portalMpesaPromptEnabled({mpesaPrompt: "Disable"})', context), false);
  assert.equal(vm.runInContext('portalMpesaPromptEnabled({mpesaPromptEnabled: true})', context), true);
  assert.equal(vm.runInContext('portalMpesaPromptEnabled({mpesaPromptEnabled: false, mpesaPrompt: "Enable"})', context), false);
  assert.equal(vm.runInContext('portalMpesaPromptEnabled({})', context), false);
});

async function checkout(respond, apiBase = "https://tenant.example.test") {
  const calls = [];
  const context = {
    Promise, JSON, Error, Array,
    MPESA_PROMPT_ENABLED: true,
    canStartPaymentCheckout: () => true,
    document: { getElementById: () => ({ value: "0700000000" }) },
    DEVICE_MAC: "02:00:00:00:00:01", DEVICE_IP: "192.168.180.254",
    PORTAL_API_BASE: apiBase, PORTAL_ADMIN_ID: 7, PORTAL_ROUTER_ID: 3, PORTAL_PORT_ID: 4,
    selectedPlan: { id: 5 }, tvPurchase: false, tvDeviceName: "", tvDeviceRouterId: 0,
    renderModal() {}, apiUrl: path => apiBase + path, setInterval: () => 1, clearInterval() {},
    fetch(url, options) {
      calls.push({ url, body: JSON.parse(options.body) });
      return respond(url, options);
    },
  };
  vm.createContext(context);
  vm.runInContext(checkoutScript, context);
  vm.runInContext("sendStk()", context);
  await new Promise(resolve => setImmediate(resolve));
  return { calls, context };
}

const intent = () => Response.json({ paymentIntent: "local-test-intent", amount: 10 });

test("checkout carries the secure intent and scoped fields to the public API", async () => {
  const { calls, context } = await checkout(url => url.endsWith("/intent")
    ? intent() : Response.json({ CheckoutRequestID: "local-test-checkout" }));
  assert.equal(context.stkState, "sent");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://tenant.example.test/api/mpesa/stk");
  assert.equal(calls[1].body.paymentIntent, "local-test-intent");
  assert.equal(calls[1].body.amount, 10);
  assert.equal(calls[1].body.router_id, 3);
  assert.equal(calls[1].body.port_id, 4);
});

test("a rejected intent preserves the server error and does not submit STK", async () => {
  const { calls, context } = await checkout(() => Response.json(
    { error: "Package does not belong to this service." }, { status: 409 },
  ));
  assert.equal(calls.length, 1);
  assert.equal(context.stkError, "Package does not belong to this service.");
});

test("HTML proxy errors report the setup stage, HTTP status and API address", async () => {
  const { calls, context } = await checkout(() => new Response("<html>Bad gateway</html>", { status: 502 }));
  assert.equal(calls.length, 1);
  assert.match(context.stkError, /Payment setup.*non-JSON.*HTTP 502.*\/api\/mpesa\/intent/);
});

test("an HTML captive redirect is not reported as a generic network failure", async () => {
  const { context } = await checkout(() => ({
    ok: true, status: 200, redirected: true, text: async () => "<html>Sign in</html>",
  }));
  assert.match(context.stkError, /non-JSON.*HTTP 200.*redirected/);
});

test("connection failures identify setup and prevent STK submission", async () => {
  const { calls, context } = await checkout(() => Promise.reject(new TypeError("Failed to fetch")));
  assert.equal(calls.length, 1);
  assert.match(context.stkError, /Payment setup could not reach.*\/api\/mpesa\/intent/);
});

test("synchronous fetch failures are caught without leaving the modal loading", async () => {
  const { context } = await checkout(() => { throw new TypeError("Fetch unavailable"); });
  assert.equal(context.stkState, "error");
  assert.match(context.stkError, /Payment setup could not reach/);
});

test("a failed STK response names the prompt step and never resubmits", async () => {
  const { calls, context } = await checkout(url => url.endsWith("/intent")
    ? intent() : new Response("<html>Unavailable</html>", { status: 503 }));
  assert.equal(calls.length, 2);
  assert.match(context.stkError, /M-Pesa prompt request.*non-JSON.*HTTP 503.*\/api\/mpesa\/stk/);
});

test("missing public API configuration fails explicitly without making requests", async () => {
  const { calls, context } = await checkout(() => { throw new Error("Must not call fetch"); }, "");
  assert.equal(calls.length, 0);
  assert.match(context.stkError, /no valid public payment API address/);
});

const fetchWrapper = template.slice(
  template.indexOf("var originalPortalFetch="),
  template.indexOf("function setPortalText("),
);

async function portalHeaders(config, path = "https://tenant.example.test/api/mpesa/intent") {
  const captured = [];
  const context = {
    URL, URLSearchParams, Headers, Request, Number, String, Object,
    EMBEDDED_CONFIG: config,
    PORTAL_API_BASE: "https://tenant.example.test",
    PORTAL_QUERY: new URLSearchParams("nasid=router-identity&server=hs1"),
    PORTAL_NAS_IDENTIFIER: "router-identity",
    PORTAL_HOTSPOT_SERVER_NAME: "hs1",
    window: {
      location: { href: "http://portal.example.test/login", origin: "http://portal.example.test" },
      fetch(input, options) {
        captured.push({ input, headers: new Headers(options?.headers) });
        return Promise.resolve(Response.json({ ok: true }));
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(fetchWrapper, context);
  await context.window.fetch(path, { headers: { "Content-Type": "application/json" } });
  return captured[0].headers;
}

test("normal ISP bridge ignores reseller-only identity query hints", async () => {
  const headers = await portalHeaders({ adminId: 7, routerId: 3, portId: 0 });
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.has("X-Hotspot-NAS-Identifier"), false);
  assert.equal(headers.has("X-Hotspot-Server-Name"), false);
  assert.equal(headers.has("X-Hotspot-Portal-Context"), false);
});

test("signed reseller portals retain all scope verification headers", async () => {
  const headers = await portalHeaders({
    adminId: 7, routerId: 3, portId: 4, resellerId: 8, portalContextToken: "test-signed-scope",
  });
  assert.equal(headers.get("X-Hotspot-Portal-Context"), "test-signed-scope");
  assert.equal(headers.get("X-Hotspot-NAS-Identifier"), "router-identity");
  assert.equal(headers.get("X-Hotspot-Server-Name"), "hs1");
});

test("unsigned port-scoped portals retain identity headers for server rejection", async () => {
  const headers = await portalHeaders({ adminId: 7, routerId: 3, portId: 4 });
  assert.equal(headers.has("X-Hotspot-Portal-Context"), false);
  assert.equal(headers.get("X-Hotspot-Server-Name"), "hs1");
});

test("unsigned reseller portals cannot be classified as plain ISP bridges", async () => {
  const headers = await portalHeaders({ adminId: 7, routerId: 3, portId: 0, resellerId: 8 });
  assert.equal(headers.get("X-Hotspot-NAS-Identifier"), "router-identity");
});

test("missing embedded configuration retains existing fail-closed identity behavior", async () => {
  const headers = await portalHeaders(null);
  assert.equal(headers.get("X-Hotspot-NAS-Identifier"), "router-identity");
});

test("portal tokens are not added to requests outside the configured API origin", async () => {
  const headers = await portalHeaders({
    adminId: 7, routerId: 3, portId: 4, portalContextToken: "test-signed-scope",
  }, "https://unrelated.example.test/api/mpesa/intent");
  assert.equal(headers.has("X-Hotspot-Portal-Context"), false);
  assert.equal(headers.has("X-Hotspot-NAS-Identifier"), false);
});