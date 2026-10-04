import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const portalHtml = readFileSync(
  new URL("../../ochola-supernet/public/hotspot/login.html", import.meta.url),
  "utf8",
);

function functionRange(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `could not extract ${startMarker}`);
  return source.slice(start, end);
}

function createTimers() {
  const timers = [];
  let nextId = 0;
  return {
    timers,
    window: {
      setTimeout(callback, delay) {
        const timer = { id: ++nextId, callback, delay, cleared: false };
        timers.push(timer);
        return timer.id;
      },
      clearTimeout(id) {
        const timer = timers.find(item => item.id === id);
        if (timer) timer.cleared = true;
      },
    },
  };
}

function createPaymentHarness(fetchImplementation) {
  const timerState = createTimers();
  const updates = [];
  const context = {
    AbortController,
    PORTAL_API_TIMEOUT_MS: 4000,
    PORTAL_PREVIEW_ONLY: false,
    PORTAL_API_BASE: "https://tenant.example.test",
    PORTAL_ADMIN_ID: 3,
    PORTAL_ROUTER_ID: 108,
    PORTAL_PORT_ID: 0,
    MPESA_PROMPT_ENABLED: true,
    PAYMENT_STATUS_LOADED: false,
    PAYMENT_METHOD_READY: false,
    PAYMENT_STATUS_FAILED: false,
    PAYMENT_GATEWAY: "",
    apiUrl: path => "https://tenant.example.test" + path,
    fetch: fetchImplementation,
    isSupportedPaymentGateway: gateway =>
      ["mpesa_paybill", "mpesa_till_push", "bank_stk_push"].includes(gateway),
    updatePaymentAvailability: () => updates.push("updated"),
    window: timerState.window,
  };

  runInNewContext(
    functionRange(portalHtml, "function canStartPaymentCheckout(){", "function paymentGatewayLabel(")
      + functionRange(portalHtml, "function loadPaymentStatus(){", "/* ── Load and keep hotspot plans fresh ── */")
      + "\nglobalThis.startPaymentCheck=loadPaymentStatus;",
    context,
  );

  return { context, timers: timerState.timers, updates, start: context.startPaymentCheck };
}

function createPlanHarness(fetchImplementation) {
  const timerState = createTimers();
  const renderEvents = [];
  const embeddedPlans = [
    { id: 1, name: "comeon", price: 10, validity: 1, unit: "Days" },
    { id: 2, name: "WEZESHA", price: 20, validity: 2, unit: "Days" },
  ];
  let context;
  context = {
    PORTAL_API_TIMEOUT_MS: 4000,
    PORTAL_PREVIEW_ONLY: false,
    PORTAL_ADMIN_ID: 3,
    PORTAL_ROUTER_ID: 108,
    PORTAL_PORT_ID: 0,
    PLAN_REFRESH_INTERVAL: 10000,
    planRefreshTimer: null,
    planRequestInFlight: false,
    plansInitialised: false,
    lastPlanSignature: "",
    PLANS: [],
    EMBEDDED_PLANS: embeddedPlans,
    AbortController,
    apiUrl: path => path,
    document: { hidden: false, addEventListener() {} },
    fetch: fetchImplementation,
    normalisePlanList: value => Array.isArray(value) ? value : [],
    renderPlans: () => renderEvents.push(JSON.stringify(context.PLANS)),
    setInterval: () => 1,
    window: timerState.window,
  };

  runInNewContext(
    functionRange(portalHtml, "function planSignature(plans){", "function renderPlans(){")
      + "\nglobalThis.startPlanLoad=loadPlans;",
    context,
  );

  return {
    context,
    embeddedPlans,
    renderEvents,
    timers: timerState.timers,
    start: context.startPlanLoad,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("payment status failures do not lock out checkout attempts; the payment service verifies them", async () => {
  for (const fetchImplementation of [
    () => Promise.reject(new Error("pre-login network blocked")),
    () => { throw new Error("fetch threw synchronously"); },
    () => Promise.resolve({ ok: false, status: 503 }),
  ]) {
    const harness = createPaymentHarness(fetchImplementation);
    await harness.start();

    assert.equal(harness.context.PAYMENT_STATUS_LOADED, true);
    assert.equal(harness.context.PAYMENT_METHOD_READY, false);
    assert.equal(harness.context.PAYMENT_STATUS_FAILED, true);
    assert.equal(harness.context.PAYMENT_GATEWAY, "");
    assert.equal(harness.context.canStartPaymentCheckout(), true);
    assert.deepEqual(harness.updates, ["updated", "updated"]);
    assert.ok(harness.timers.some(timer => timer.delay === 4000 && timer.cleared));
  }

  let requestSignal;
  const timeoutHarness = createPaymentHarness((_url, options) => {
    requestSignal = options.signal;
    return new Promise(() => {});
  });
  const completion = timeoutHarness.start();
  await Promise.resolve();
  const timer = timeoutHarness.timers.find(item => item.delay === 4000);
  assert.ok(timer, "payment status should have a four-second fallback");
  timer.callback();
  await completion;

  assert.equal(timeoutHarness.context.PAYMENT_STATUS_LOADED, true);
  assert.equal(timeoutHarness.context.PAYMENT_METHOD_READY, false);
  assert.equal(timeoutHarness.context.PAYMENT_STATUS_FAILED, true);
  assert.equal(timeoutHarness.context.canStartPaymentCheckout(), true);
  assert.equal(requestSignal.aborted, true);
  assert.deepEqual(timeoutHarness.updates, ["updated", "updated"]);

  const explicitlyUnconfiguredHarness = createPaymentHarness(() => Promise.resolve({
    ok: true,
    json: async () => ({
      configured: false,
      settings: { destinationConfigured: false, paymentGateway: "mpesa_paybill" },
    }),
  }));
  await explicitlyUnconfiguredHarness.start();
  assert.equal(explicitlyUnconfiguredHarness.context.PAYMENT_STATUS_FAILED, false);
  assert.equal(explicitlyUnconfiguredHarness.context.canStartPaymentCheckout(), false);
});

test("embedded packages render immediately and survive failed or timed-out plan lookups", async () => {
  for (const fetchImplementation of [
    () => Promise.reject(new Error("pre-login network blocked")),
    () => { throw new Error("fetch threw synchronously"); },
    () => Promise.resolve({ ok: false, status: 503 }),
  ]) {
    const harness = createPlanHarness(fetchImplementation);
    harness.start();
    assert.deepEqual(plain(harness.context.PLANS), harness.embeddedPlans);
    assert.equal(harness.renderEvents.length, 1, "embedded packages render before the request settles");

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(plain(harness.context.PLANS), harness.embeddedPlans);
    assert.equal(harness.renderEvents.length, 1, "a failed lookup must not replace or hide embedded packages");
    assert.equal(harness.context.planRequestInFlight, false);
  }

  const timeoutHarness = createPlanHarness(() => new Promise(() => {}));
  timeoutHarness.start();
  const timer = timeoutHarness.timers.find(item => item.delay === 4000);
  assert.ok(timer, "plan lookup should have a four-second fallback");
  timer.callback();

  assert.deepEqual(plain(timeoutHarness.context.PLANS), timeoutHarness.embeddedPlans);
  assert.equal(timeoutHarness.renderEvents.length, 1);
  assert.equal(timeoutHarness.context.planRequestInFlight, false);
});

test("RouterOS errors, CHAP login fields, MAC fallback, and mobile layout stay valid", () => {
  const errorStart = portalHtml.indexOf("$(if error)");
  const errorEnd = portalHtml.indexOf("$(endif)", errorStart);
  assert.ok(errorStart >= 0 && errorEnd > errorStart);
  const errorBlock = portalHtml.slice(errorStart, errorEnd);
  assert.match(errorBlock, /class="error-box" role="alert"/);
  assert.match(errorBlock, /Login Failed:/);
  assert.match(errorBlock, /\$\(error\)/);

  assert.match(portalHtml, /<form name="sendin" id="mikrotikForm" action="\$\(link-login-only\)" method="post"/);
  assert.match(portalHtml, /value="\$\(username\)"/);
  assert.match(portalHtml, /var ROUTER_CHAP_ID="\$\(chap-id\)"/);
  assert.match(portalHtml, /var ROUTER_CHAP_CHALLENGE="\$\(chap-challenge\)"/);
  assert.match(portalHtml, /normaliseMac\(ROUTER_MAC\)\|\|normaliseMac\(PORTAL_QUERY\.get\("mac"\)/);
  assert.match(portalHtml, /value\.textContent=mac\|\|"Resolved by router"/);

  const hideRule = functionRange(
    portalHtml,
    "function shouldHidePackageSection(",
    "function applyPortalConfig(",
  );
  assert.doesNotMatch(hideRule, /PAYMENT_STATUS_LOADED|PAYMENT_METHOD_READY/);
  assert.match(portalHtml, /<meta name="viewport" content="width=device-width, initial-scale=1\.0"/);
  assert.match(portalHtml, /grid-template-columns:repeat\(auto-fill,minmax\(168px,1fr\)\)/);
});