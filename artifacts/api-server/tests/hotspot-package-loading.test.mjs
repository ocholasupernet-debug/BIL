import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const html = readFileSync(new URL("../../ochola-supernet/public/hotspot/login.html", import.meta.url), "utf8");
const normalizer = html.slice(html.indexOf("function normalisePlanList("), html.indexOf("function applyPortalConfig("));
const loader = html.slice(html.indexOf("function planSignature("), html.indexOf("function renderPlans("));
const plan = { id: 5, name: "One hour", price: 10, validity: 1, validity_unit: "Hours" };
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(respond = () => Promise.resolve(Response.json([plan])), overrides = {}) {
  const calls = [], rendered = [], timeouts = [];
  const context = {
    PORTAL_ADMIN_ID: 7, PORTAL_ROUTER_ID: 3, PORTAL_PORT_ID: 4,
    PORTAL_API_BASE: "https://tenant.example.test", PORTAL_PREVIEW_ONLY: false, PORTAL_API_TIMEOUT_MS: 4000, PAYMENT_METHOD_READY: true, PAYMENT_STATUS_LOADED: true,
    PLANS: [], EMBEDDED_PLANS: [], plansInitialised: false, plansLoadedFromApi: false,
    planLoadError: "", lastPlanSignature: "", planRequestInFlight: false,
    planRefreshTimer: null, PLAN_REFRESH_INTERVAL: 10000, canStartPaymentCheckout: () => true,
    document: { hidden: false, addEventListener() {} },
    window: { setTimeout: fn => { timeouts.push(fn); return timeouts.length; }, clearTimeout() {} },
    setInterval: () => 1, setTimeout: fn => { timeouts.push(fn); },
    apiUrl: path => path,
    fetch: (url, options) => { calls.push({ url, options }); return respond(url); },
    ...overrides,
  };
  context.renderPlans = () => rendered.push({ ids: Array.from(context.PLANS, p => p.id), error: context.planLoadError });
  vm.createContext(context);
  vm.runInContext(normalizer + loader, context);
  return { context, calls, rendered, timeouts };
}

test("scoped package fetch renders real plans and bypasses stale HTTP caches", async () => {
  const { context, calls, rendered } = setup();
  context.loadPlans();
  await tick();
  assert.match(calls[0].url, /adminId=7&routerId=3&portId=4/);
  assert.equal(calls[0].options.cache, "no-store");
  assert.deepEqual(rendered.at(-1).ids, [5]);
});

test("missing router context never issues an unscoped package request", () => {
  const { context, calls, rendered } = setup(undefined, { PORTAL_ROUTER_ID: 0 });
  context.loadPlans();
  assert.equal(calls.length, 0);
  assert.match(rendered.at(-1).error, /missing its router configuration/);
});

test("malformed success payload does not clear embedded packages", async () => {
  const { context } = setup(() => Promise.resolve(Response.json({ error: "unavailable" })));
  context.EMBEDDED_PLANS = context.normalisePlanList([plan]);
  context.loadPlans();
  await tick();
  assert.equal(context.PLANS[0].id, 5);
  assert.equal(context.plansLoadedFromApi, false);
});

test("successful empty results remove withdrawn plans and do not restore them on retry", async () => {
  const { context } = setup(() => Promise.resolve(Response.json([])));
  context.EMBEDDED_PLANS = context.normalisePlanList([plan]);
  context.loadPlans();
  await tick();
  assert.equal(context.PLANS.length, 0);
  context.loadPlans();
  assert.equal(context.PLANS.length, 0);
  await tick();
});

test("late embedded plans render without waiting for a stalled API", () => {
  const { context, rendered } = setup(() => new Promise(() => {}));
  context.loadPlans();
  context.EMBEDDED_PLANS = context.normalisePlanList([plan]);
  context.loadPlans();
  assert.deepEqual(rendered.at(-1).ids, [5]);
});

test("timeouts expose an error and allow retry", async () => {
  let requests = 0;
  const { context, timeouts } = setup(() => ++requests === 1
    ? new Promise(() => {}) : Promise.resolve(Response.json([plan])));
  context.loadPlans();
  timeouts[0]();
  assert.match(context.planLoadError, /could not be loaded/);
  context.loadPlans();
  await tick();
  assert.equal(context.PLANS[0].id, 5);
  assert.equal(context.planLoadError, "");
});

test("a response from an old scope cannot replace the current service packages", async () => {
  let resolveFirst;
  let requests = 0;
  const { context } = setup(() => ++requests === 1
    ? new Promise(resolve => { resolveFirst = resolve; })
    : Promise.resolve(Response.json([plan])));
  context.loadPlans();
  await tick();
  context.PORTAL_PORT_ID = 9;
  resolveFirst(Response.json([]));
  await tick();
  assert.equal(requests, 2);
  assert.equal(context.PLANS[0].id, 5);
});

test("package context is established before optional appearance code", () => {
  const body = html.slice(html.indexOf("function applyPortalConfig("), html.indexOf("function applyPortalTypography("));
  assert.ok(body.indexOf("PORTAL_ROUTER_ID=Number") < body.indexOf("applyPortalCardVisibility()"));
  assert.ok(body.indexOf("EMBEDDED_PLANS=configuredPlans") < body.indexOf("applyPortalCardVisibility()"));
});

test("a styling exception cannot prevent scoped embedded packages from loading", () => {
  const { context, rendered } = setup(() => new Promise(() => {}), {
    PORTAL_ADMIN_ID: 0, PORTAL_ROUTER_ID: 0, PORTAL_PORT_ID: 0,
    safePublicApiBase: value => value,
    normalisePortalCardVisibility: () => ({}),
    applyPortalCardVisibility: () => { throw new Error("Appearance failure"); },
  });
  const applyConfig = html.slice(html.indexOf("function applyPortalConfig("), html.indexOf("function applyPortalTypography("));
  vm.runInContext(applyConfig, context);
  assert.throws(() => context.applyPortalConfig({
    adminId: 7, routerId: 3, portId: 4,
    apiBase: "https://tenant.example.test", plans: [plan],
  }), /Appearance failure/);
  context.loadPlans();
  assert.equal(context.PORTAL_ROUTER_ID, 3);
  assert.equal(context.PORTAL_PORT_ID, 4);
  assert.deepEqual(rendered.at(-1).ids, [5]);
});

test("the HTML renders a package card and exposes an actionable empty/error state", () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {});
    return elements.get(id);
  };
  const context = {
    PLANS: [{ ...plan, unit: "Hours" }], PORTAL_PACKAGE_SHAPE: "rounded",
    COLORS: [{ from: "#000", to: "#fff", glow: "#000", badge: "#000" }],
    document: { getElementById: element },
    bindPlanButtons() {}, loadPlans() {},
    planLoadError: "Packages could not be loaded.", plansLoadedFromApi: false,
    PORTAL_PREVIEW_ONLY: false, canStartPaymentCheckout: () => true, PAYMENT_METHOD_READY: true,
  };
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf("function renderPlans("), html.indexOf("/* ── STK Modal")), context);
  context.renderPlans();
  assert.match(element("plansGrid").innerHTML, /One hour/);
  assert.match(element("plansGrid").innerHTML, /Connect Now/);
  context.PLANS = [];
  context.renderPlans();
  assert.equal(element("planLoadMessage").textContent, "Packages could not be loaded.");
  assert.equal(typeof element("retryPlansButton").onclick, "function");
});