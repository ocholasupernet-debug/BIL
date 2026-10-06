import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

process.env.SESSION_SECRET = "reseller-portal-route-test-secret";
process.env.VITE_SUPABASE_URL = "https://reseller-portal-route-test.supabase.co";
process.env.VITE_SUPABASE_KEY = "reseller-portal-route-test-anon";
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_SERVICE_KEY;

const scope = { adminId: 7, resellerId: 19, routerId: 31, portId: 43 };
const scopeTokenPromise = import("../lib/api-auth.js").then(({ generateVlanHotspotPortalContextToken }) =>
  generateVlanHotspotPortalContextToken(scope),
);

const servicePort = {
  id: 43,
  admin_id: 7,
  router_id: 31,
  assigned_reseller_id: 19,
  handoff_mode: "vlan_services",
  nas_identifier: "shared-router",
  interface_name: "ether4",
  bridge_name: "br-reseller-43",
  reseller_id: 19,
  vlan_tag: "143",
  subnet_range: "10.43.0.0/24",
  status: "active",
  link_status: "active",
  hotspot_enabled: true,
};
const siblingServicePort = {
  ...servicePort,
  id: 44,
  assigned_reseller_id: 20,
  vlan_tag: "144",
  interface_name: "ether5",
};
const ispOwnedServicePort = {
  ...servicePort,
  id: 45,
  assigned_reseller_id: null,
  reseller_id: null,
  handoff_mode: "services",
  vlan_tag: null,
  interface_name: "ether2",
};

const assignedPlan = {
  id: 501,
  admin_id: 7,
  name: "Assigned package",
  type: "hotspot",
  price: 100,
  is_active: true,
  client_can_purchase: true,
  router_id: 31,
  port_id: 43,
  owner_reseller_id: 19,
  speed_down: 10,
  speed_up: 5,
  speed_down_unit: "Mbps",
  speed_up_unit: "Mbps",
  data_limit_mb: 1000,
  data_cap_mode: "throttle",
  fup_speed_down: 2,
  fup_speed_up: 1,
  shared_users: 1,
  validity: 1,
  validity_unit: "hours",
  validity_days: null,
};

const siblingPlan = {
  id: 502,
  admin_id: 7,
  name: "Sibling package",
  type: "hotspot",
  price: 200,
  is_active: true,
  router_id: 31,
  port_id: 44,
  owner_reseller_id: 20,
};
const ispOwnedPortPlan = {
  ...assignedPlan,
  id: 503,
  name: "ISP port package",
  port_id: 45,
  owner_reseller_id: null,
};
const otherRouterPortPlan = {
  ...ispOwnedPortPlan,
  id: 504,
  name: "Other router package",
  router_id: 32,
  port_id: 46,
};

const siblingTransaction = {
  id: 601,
  admin_id: 7,
  customer_id: 801,
  plan_id: 502,
  payment_phone: "254700000000",
  mac_address: "AA:BB:CC:DD:EE:FF",
  mpesa_receipt: "AB12345678",
  reference: "sibling-checkout",
  status: "paid",
  payment_method: "mpesa",
  created_at: "2026-09-28T12:00:00.000Z",
};

const siblingCustomer = {
  id: 801,
  admin_id: 19,
  name: "Sibling customer",
  phone: "254700000000",
  mac_address: "AA:BB:CC:DD:EE:FF",
  username: "sibling-account",
  password: "not-returned",
  type: "hotspot",
  plan_id: 502,
  router_id: 31,
  port_id: 44,
  ip_address: "10.44.0.10",
  status: "active",
  expires_at: "2027-09-29T00:00:00.000Z",
};

const assignedCustomer = {
  id: 802,
  admin_id: 19,
  name: "Assigned customer",
  phone: "254700000000",
  mac_address: "AA:BB:CC:DD:EE:FF",
  username: "assigned-account",
  password: "assigned-password",
  type: "hotspot",
  plan_id: 501,
  router_id: 31,
  port_id: 43,
  ip_address: "10.43.0.10",
  status: "active",
  expires_at: "2027-09-29T00:00:00.000Z",
};

const assignedTransaction = {
  id: 602,
  admin_id: 7,
  customer_id: 802,
  plan_id: 501,
  payment_phone: "254700000000",
  mac_address: "AA:BB:CC:DD:EE:FF",
  mpesa_receipt: "CD12345678",
  reference: "assigned-checkout",
  status: "paid",
  payment_method: "mpesa",
  created_at: "2026-09-29T12:00:00.000Z",
};

type DbRequest = {
  table: string;
  method: string;
  query: URLSearchParams;
  rawQuery: string;
  body?: Record<string, unknown>;
};

function matches(row: Record<string, unknown>, query: URLSearchParams): boolean {
  for (const [key, rawFilter] of query) {
    const value = row[key];
    if (rawFilter.startsWith("eq.")) {
      const expected = rawFilter.slice(3);
      if (expected === "null" ? value !== null : String(value) !== expected) return false;
    } else if (rawFilter === "is.null" && value !== null) {
      return false;
    } else if (rawFilter === "is.true" && value !== true) {
      return false;
    } else if (rawFilter === "neq.disabled" && value === "disabled") {
      return false;
    } else if (rawFilter.startsWith("in.(")) {
      const values = rawFilter.slice(4, -1).split(",");
      if (!values.includes(String(value))) return false;
    } else if (rawFilter.startsWith("like.")) {
      const prefix = rawFilter.slice(5).replace(/\*+$/, "");
      if (!String(value ?? "").startsWith(prefix)) return false;
    }
  }
  return true;
}

test("signed reseller portal requests stay within their assigned service", async (t) => {
  const [
    { generateAdminSessionToken, generatePaymentIntent, resolveVlanHotspotPortalRequest },
    { default: customersRouter },
    {
      default: mpesaRouter,
      loadHotspotPortContext,
      hotspotPortResources,
      hotspotPaymentOperations,
    },
    { default: plansRouter },
    { default: settingsRouter },
    { default: brandingRouter },
    { default: typographyRouter },
  ] = await Promise.all([
    import("../lib/api-auth.js"),
    import("./customers.js"),
    import("./mpesa-route.js"),
    import("./plans.js"),
    import("./settings-route.js"),
    import("./hotspot-branding-route.js"),
    import("./typography-route.js"),
  ]);

  const app = express();
  app.use(express.json());
  app.use(resolveVlanHotspotPortalRequest);
  app.use("/api", customersRouter, mpesaRouter, plansRouter, settingsRouter, brandingRouter, typographyRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch;
  const dbRequests: DbRequest[] = [];
  let transactions: Record<string, unknown>[] = [];
  let customers: Record<string, unknown>[] = [];
  let legacyCheckout = false;
  let includeRouterFixture = false;
  let resolvedPortalClientMac = "AA:BB:CC:DD:EE:FF";
  const routerOperations: Array<{ name: string; [key: string]: unknown }> = [];
  const recordRouterOperation = (name: string, details: Record<string, unknown> = {}) => {
    routerOperations.push({ name, ...details });
  };
  const originalHotspotOperations = { ...hotspotPaymentOperations };

  hotspotPaymentOperations.ensureHotspotServerAddressPool = async (_credentials, options) => {
    recordRouterOperation("ensurePool", { server: options.serverName, pool: options.poolName });
  };
  hotspotPaymentOperations.resolveHotspotClientIpByMac = async (_credentials, mac) => {
    recordRouterOperation("resolveClientIp", { mac });
    return "10.43.0.10";
  };
  hotspotPaymentOperations.resolveHotspotClientMac = async (_credentials, ip) => {
    recordRouterOperation("resolveClientMac", { ip });
    return resolvedPortalClientMac;
  };
  hotspotPaymentOperations.syncRadiusCustomer = async options => {
    recordRouterOperation("radiusUser", { username: options.username, planId: options.planId });
  };
  hotspotPaymentOperations.requireHotspotUserProfile = async (_credentials, profile) => {
    recordRouterOperation("ensureProfile", { profile });
  };
  hotspotPaymentOperations.updateHotspotUser = async (_credentials, username, options) => {
    recordRouterOperation("updateUser", { username, server: options.server });
  };
  hotspotPaymentOperations.addHotspotUser = async (_credentials, options) => {
    recordRouterOperation("addUser", { username: options.name, server: options.server });
  };
  hotspotPaymentOperations.upsertHotspotUser = async (_credentials, options) => {
    recordRouterOperation("upsertUser", { username: options.name, server: options.server });
  };
  hotspotPaymentOperations.scheduleHotspotUserExpiry = async (_credentials, options) => {
    recordRouterOperation("scheduleExpiry", { username: options.name });
  };
  hotspotPaymentOperations.fetchHotspotUserUsage = async (_credentials, username) => {
    recordRouterOperation("readUsage", { username });
    return { bytesIn: 0, bytesOut: 0, disabled: false };
  };
  hotspotPaymentOperations.scheduleHotspotUserFup = async (_credentials, options) => {
    recordRouterOperation("scheduleFup", { username: options.username });
  };
  hotspotPaymentOperations.removeHotspotUserFup = async (_credentials, username) => {
    recordRouterOperation("removeFup", { username });
  };
  hotspotPaymentOperations.resetHotspotUserCounters = async (_credentials, username) => {
    recordRouterOperation("resetCounters", { username });
  };
  hotspotPaymentOperations.addHotspotIpBinding = async (_credentials, options) => {
    recordRouterOperation("addBinding", { username: options.comment });
    return true;
  };
  hotspotPaymentOperations.ensureHotspotUserRateQueue = async (_credentials, options) => {
    recordRouterOperation("ensureRateQueue", { username: options.username });
  };
  hotspotPaymentOperations.connectHotspotUser = async (_credentials, options) => {
    recordRouterOperation("connectUser", { username: options.user, server: options.server });
    return true;
  };
  hotspotPaymentOperations.disconnectHotspotActiveUser = async (_credentials, username) => {
    recordRouterOperation("disconnectUser", { username });
    return false;
  };

  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    assert.equal(url.hostname, "reseller-portal-route-test.supabase.co", "unexpected outbound service request");
    const table = url.pathname.split("/").at(-1) ?? "";
    const method = (init?.method ?? "GET").toUpperCase();
    const query = new URLSearchParams(url.search);
    const body = typeof init?.body === "string"
      ? JSON.parse(init.body) as Record<string, unknown>
      : undefined;
    const request: DbRequest = { table, method, query, rawQuery: url.search.slice(1), ...(body ? { body } : {}) };
    dbRequests.push(request);

    let rows: Record<string, unknown>[] = [];
    if (table === "isp_reseller_ports") {
      rows = [servicePort, siblingServicePort, ispOwnedServicePort].filter(row => matches(row, query));
    } else if (table === "isp_admins") {
      const admins = [
        { id: 7, parent_id: null, role: "isp_admin", is_active: true, name: "Parent ISP", subdomain: "parent-isp", font_family: "DM Sans", font_style: "normal", font_weight: 500, font_size: 18, payment_gateway: "mpesa_till_push", payment_gateway_config: {}, payment_collection_mode: "separate", payment_service_config: {} },
        { id: 19, parent_id: 7, role: "reseller", is_active: true, name: "Assigned reseller", subdomain: "assigned-reseller", font_family: "Roboto", font_style: "italic", font_weight: 600, font_size: 20 },
      ];
      rows = admins.filter(row => matches(row, query));
    } else if (table === "isp_routers") {
      rows = (includeRouterFixture ? [{
        id: 31,
        admin_id: 7,
        name: "edge-1",
        host: "198.51.100.31",
        bridge_ip: null,
        vpn_ip: null,
        router_username: "router-api",
        router_secret: "router-test-secret",
      }] : []).filter(row => matches(row, query));
    } else if (table === "isp_plans") {
      rows = [assignedPlan, siblingPlan, ispOwnedPortPlan, otherRouterPortPlan].filter(row => matches(row, query));
    } else if (table === "isp_transactions") {
      rows = (legacyCheckout ? [
        { id: 701, admin_id: 23, customer_id: null, plan_id: null, reference: "legacy-checkout", status: "paid", payment_method: "mpesa" },
      ] : transactions).filter(row => matches(row, query));
    } else if (table === "isp_customers") {
      rows = customers.filter(row => matches(row, query));
    } else if (table === "isp_hotspot_branding") {
      rows = [
        { admin_id: 7, portal_hostname: "parent.example.test", settings: { ispName: "Parent ISP Theme" } },
        {
          admin_id: 19,
          portal_hostname: "reseller.example.test",
          settings: { ispName: "Assigned Reseller Theme", portalLayout: "signal-grid" },
        },
      ].filter(row => matches(row, query));
    } else if (table === "isp_dashboard_preferences") {
      rows = [
        { admin_id: 7, accent_color: "#123456", portal_background: "midnight", portal_package_shape: "rounded" },
        { admin_id: 19, accent_color: "#e14b2f", portal_background: "ocean", portal_package_shape: "pill" },
      ].filter(row => matches(row, query));
    } else if (table === "platform_secure_settings" || table === "reseller_payment_gateway_routes") {
      rows = [];
    }
    if (method === "POST" && body && table === "isp_customers") {
      const nextId = Math.max(0, ...customers.map(row => Number(row.id) || 0)) + 1;
      const created = { ...body, id: nextId };
      customers.push(created);
      rows = [created];
    }
    if (method === "PATCH" && body) {
      for (const row of rows) Object.assign(row, body);
    }
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const scopeToken = await scopeTokenPromise;
  const request = (path: string, options: {
    method?: string;
    body?: Record<string, unknown>;
    token?: string | null;
    adminToken?: string;
    nasIdentifier?: string;
    serverName?: string;
  } = {}) => {
    const headers = new Headers();
    if (options.token !== null) headers.set("X-Hotspot-Portal-Context", options.token ?? scopeToken);
    if (options.adminToken) headers.set("Authorization", `Bearer ${options.adminToken}`);
    if (options.nasIdentifier !== undefined || options.token !== null) {
      headers.set("X-Hotspot-NAS-Identifier", options.nasIdentifier ?? servicePort.nas_identifier);
    }
    if (options.serverName !== undefined || options.token !== null) {
      headers.set("X-Hotspot-Server-Name", options.serverName ?? "HS_RS19_VLAN143");
    }
    if (options.body) headers.set("Content-Type", "application/json");
    return originalFetch(`${origin}${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
  };
  const clearRequests = () => { dbRequests.length = 0; };
  const assertNoRouterOrWrites = () => {
    assert.equal(
      dbRequests.filter(row => row.table === "isp_routers").length,
      0,
      `rejected request must not look up a router: ${JSON.stringify(dbRequests.map(row => [row.table, row.method, row.rawQuery]))}`,
    );
    assert.ok(
      dbRequests.every(row => row.method === "GET"),
      `rejected request must not write to Supabase: ${JSON.stringify(dbRequests.map(row => [row.table, row.method, row.rawQuery]))}`,
    );
  };
  const assertAssignedRouterOperations = () => {
    const poolCalls = routerOperations.filter(row => row.name === "ensurePool");
    assert.deepEqual(poolCalls, [{
      name: "ensurePool",
      server: "HS_RS19_VLAN143",
      pool: "HS_POOL_RS19_VLAN143",
    }]);
    const userOperations = routerOperations.filter(row => [
      "radiusUser",
      "updateUser",
      "addUser",
      "upsertUser",
      "scheduleExpiry",
      "scheduleFup",
      "removeFup",
      "readUsage",
      "resetCounters",
      "addBinding",
      "ensureRateQueue",
      "connectUser",
    ].includes(row.name));
    assert.ok(userOperations.length > 0, "the paid account must be activated in RouterOS");
    assert.ok(userOperations.every(row => row.username === assignedCustomer.username),
      `only the assigned customer may be changed: ${JSON.stringify(userOperations)}`);
    const serverCalls = routerOperations.filter(row => [
      "updateUser",
      "addUser",
      "upsertUser",
      "connectUser",
    ].includes(row.name));
    assert.ok(serverCalls.length > 0, "the assigned user must target a named Hotspot server");
    assert.ok(serverCalls.every(row => row.server === "HS_RS19_VLAN143"),
      `the assigned user must target its canonical VLAN server: ${JSON.stringify(serverCalls)}`);
    assert.deepEqual(routerOperations.filter(row => row.name === "radiusUser"), [{
      name: "radiusUser",
      username: assignedCustomer.username,
      planId: assignedPlan.id,
    }]);
    assert.equal(
      routerOperations.some(row => {
        const serialized = JSON.stringify(row);
        return serialized.includes("RS20_VLAN144")
          || serialized.includes("HS_POOL_RS20_VLAN144")
          || serialized.includes("sibling-account");
      }),
      false,
      `sibling service resources must remain untouched: ${JSON.stringify(routerOperations)}`,
    );
    assert.ok(dbRequests.some(row => row.table === "isp_reseller_ports"
      && row.rawQuery.includes("assigned_reseller_id=eq.19")
      && row.rawQuery.includes("handoff_mode=eq.vlan_services")
      && row.rawQuery.includes("link_status=eq.active")));
    const writes = dbRequests.filter(row => row.method !== "GET");
    assert.ok(writes.length > 0, "a successful flow should persist its assigned account state");
    assert.ok(writes.every(row => {
      if (row.table === "isp_customers") {
        return row.query.get("id") === `eq.${assignedCustomer.id}`
          && row.query.get("admin_id") === "eq.19";
      }
      if (row.table === "isp_transactions") {
        return row.query.get("id") === `eq.${assignedTransaction.id}`
          && row.query.get("admin_id") === "eq.7";
      }
      return false;
    }), `only the assigned transaction/customer may be written: ${JSON.stringify(writes)}`);
  };

  t.after(async () => {
    globalThis.fetch = originalFetch;
    Object.assign(hotspotPaymentOperations, originalHotspotOperations);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  await t.test("customer Hotspot lookup without router scope is an error, not an empty plan list", async () => {
    clearRequests();
    const response = await request(
      "/api/plans?adminId=7&type=hotspot&activeOnly=true&purchasableOnly=true",
      { token: null },
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "The Hotspot portal is missing its router or service scope.",
    });
    assert.equal(dbRequests.some(row => row.table === "isp_plans"), false);
    assertNoRouterOrWrites();
  });

  await t.test("valid router scope with no eligible plans remains an authoritative empty list", async () => {
    clearRequests();
    const response = await request(
      "/api/plans?adminId=7&routerId=999&type=hotspot&activeOnly=true&purchasableOnly=true",
      { token: null },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
    assert.ok(dbRequests.some(row => row.table === "isp_plans"
      && row.rawQuery.includes("router_id=eq.999")
      && row.rawQuery.includes("port_id=is.null")
      && row.rawQuery.includes("is_active=is.true")
      && row.rawQuery.includes("client_can_purchase=is.true")));
  });

  await t.test("tampered scopes and conflicting caller IDs stop before route handlers", async () => {
    clearRequests();
    const [encoded, signature] = scopeToken.split(".");
    const tampered = `${encoded}.${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
    const invalid = await request("/api/plans", { token: tampered });
    assert.equal(invalid.status, 403);
    assert.equal(dbRequests.length, 0);

    clearRequests();
    const queryConflict = await request("/api/plans?routerId=32");
    assert.equal(queryConflict.status, 403);
    assert.equal(dbRequests.filter(row => row.table === "isp_plans").length, 0);

    clearRequests();
    const bodyConflict = await request("/api/customers/hotspot-login", {
      method: "POST",
      body: { username: "sibling-account", password: "password", router_id: 32 },
    });
    assert.equal(bodyConflict.status, 403);
    assert.equal(dbRequests.filter(row => row.table === "isp_routers").length, 0);
  });

  await t.test("shared-router NAS identity must match the exact VLAN HotSpot server", async () => {
    clearRequests();
    const wrongCase = await request("/api/plans?type=hotspot", { nasIdentifier: "Shared-Router" });
    assert.equal(wrongCase.status, 403);
    assert.equal(dbRequests.some(row => row.table === "isp_plans"), false);
    assertNoRouterOrWrites();

    clearRequests();
    const wrongServer = await request("/api/plans?type=hotspot", { serverName: "HS_RS19_VLAN144" });
    assert.equal(wrongServer.status, 403);
    assert.equal(dbRequests.some(row => row.table === "isp_plans"), false);
    assertNoRouterOrWrites();

    clearRequests();
    const siblingVlanServer = await request("/api/plans?type=hotspot", { serverName: "HS_RS20_VLAN144" });
    assert.equal(siblingVlanServer.status, 403);
    assert.equal(dbRequests.some(row => row.table === "isp_plans"), false);
    assertNoRouterOrWrites();

    clearRequests();
    const missingIdentity = await request("/api/plans?type=hotspot", {
      token: null,
      nasIdentifier: "shared-router",
      serverName: "HS_RS19_VLAN143",
    });
    assert.equal(missingIdentity.status, 403);
    assert.equal(dbRequests.some(row => row.table === "isp_plans"), false);
    assertNoRouterOrWrites();
  });

  await t.test("an old portal context is rejected after its port is reassigned", async () => {
    servicePort.assigned_reseller_id = 20;
    clearRequests();
    try {
      const response = await request("/api/plans?type=hotspot");
      assert.equal(response.status, 403);
      assert.equal(dbRequests.some(row => row.table === "isp_plans"), false);
      assertNoRouterOrWrites();
    } finally {
      servicePort.assigned_reseller_id = 19;
    }
  });

  await t.test("valid scope lists plans only for its reseller, router, and port", async () => {
    clearRequests();
    const response = await request("/api/plans?type=hotspot");
    assert.equal(response.status, 200);
    const rows = await response.json() as Array<{ id: number }>;
    assert.deepEqual(rows.map(row => row.id), [assignedPlan.id]);
    assert.ok(dbRequests.some(row => row.table === "isp_plans"
      && row.rawQuery.includes("admin_id=eq.7")
      && row.rawQuery.includes("router_id=eq.31")
      && row.rawQuery.includes("port_id=eq.43")
      && row.rawQuery.includes("owner_reseller_id=eq.19")));
  });

  await t.test("ISP hotspot preview context includes same-router port packages only", async () => {
    includeRouterFixture = true;
    clearRequests();
    try {
      const response = await request("/api/plans/admin-context?hotspotPreview=true&routerId=31", {
        token: null,
        adminToken: generateAdminSessionToken("7", 1),
      });
      assert.equal(response.status, 200, await response.clone().text());
      const body = await response.json() as { plans: Array<{ id: number }> };
      assert.deepEqual(body.plans.map(plan => plan.id), [ispOwnedPortPlan.id]);
      assert.ok(dbRequests.some(row => row.table === "isp_plans"
        && row.rawQuery.includes("admin_id=eq.7")
        && row.rawQuery.includes("owner_reseller_id=is.null")));
    } finally {
      includeRouterFixture = false;
    }
  });

  await t.test("regular ISP admin context keeps its existing plan scope", async () => {
    clearRequests();
    const response = await request("/api/plans/admin-context", {
      token: null,
      adminToken: generateAdminSessionToken("7", 1),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json() as { plans: Array<{ id: number }> };
    assert.deepEqual(body.plans, []);
  });

  await t.test("reseller hotspot preview context remains on its selected assigned port", async () => {
    includeRouterFixture = true;
    clearRequests();
    try {
      const response = await request("/api/plans/admin-context?hotspotPreview=true&routerId=31&portId=43", {
        token: null,
        adminToken: generateAdminSessionToken("19", 1),
      });
      assert.equal(response.status, 200, await response.clone().text());
      const body = await response.json() as { plans: Array<{ id: number }> };
      assert.deepEqual(body.plans.map(plan => plan.id), [assignedPlan.id]);

      const siblingPortResponse = await request("/api/plans/admin-context?hotspotPreview=true&routerId=31&portId=44", {
        token: null,
        adminToken: generateAdminSessionToken("19", 1),
      });
      assert.equal(siblingPortResponse.status, 403);
    } finally {
      includeRouterFixture = false;
    }
  });

  await t.test("portal appearance and typography load from the mapped reseller", async () => {
    clearRequests();
    const brandingResponse = await request("/api/public/hotspot-branding?adminId=7");
    assert.equal(brandingResponse.status, 200);
    const branding = await brandingResponse.json() as {
      adminId: number;
      branding: { settings: { ispName?: string; portalLayout?: string } };
    };
    assert.equal(branding.adminId, 7);
    assert.equal(branding.branding.settings.ispName, "Assigned Reseller Theme");
    assert.equal(branding.branding.settings.portalLayout, "signal-grid");
    assert.ok(dbRequests.some(row => row.table === "isp_hotspot_branding"
      && row.rawQuery.includes("admin_id=eq.19")));

    clearRequests();
    const typographyResponse = await request("/api/public/typography?adminId=7");
    assert.equal(typographyResponse.status, 200);
    const typography = await typographyResponse.json() as {
      adminId: number;
      fontFamily: string;
      accentColor: string;
      portalBackground: string;
      portalPackageShape: string;
    };
    assert.equal(typography.adminId, 7);
    assert.equal(typography.fontFamily, "Roboto");
    assert.equal(typography.accentColor, "#e14b2f");
    assert.equal(typography.portalBackground, "ocean");
    assert.equal(typography.portalPackageShape, "pill");
    assert.ok(dbRequests.some(row => row.table === "isp_admins"
      && row.rawQuery.includes("id=eq.19")));
    assert.ok(dbRequests.some(row => row.table === "isp_dashboard_preferences"
      && row.rawQuery.includes("admin_id=eq.19")));
  });

  await t.test("paid activation resolves the assigned VLAN Hotspot resource identity", async () => {
    clearRequests();
    const port = await loadHotspotPortContext(7, 31, 43, 19);
    assert.ok(port);
    assert.equal(port.handoff_mode, "vlan_services");
    assert.equal(port.assigned_reseller_id, 19);
    const resources = hotspotPortResources(port, { companyName: "Parent ISP", routerName: "edge-1" });
    assert.equal(resources.serverName, "HS_RS19_VLAN143");
    assert.equal(resources.poolName, "HS_POOL_RS19_VLAN143");
    assert.ok(dbRequests.some(row => row.table === "isp_reseller_ports"
      && row.rawQuery.includes("assigned_reseller_id=eq.19")
      && row.rawQuery.includes("handoff_mode=eq.vlan_services")
      && row.rawQuery.includes("link_status=eq.active")));

    servicePort.assigned_reseller_id = 20;
    clearRequests();
    try {
      await assert.rejects(loadHotspotPortContext(7, 31, 43, 19), /assignment changed/);
      assertNoRouterOrWrites();
    } finally {
      servicePort.assigned_reseller_id = 19;
    }
  });

  await t.test("signed paid portal activation targets only the assigned VLAN Hotspot service", async () => {
    transactions = [{ ...assignedTransaction }];
    customers = [{ ...assignedCustomer }];
    routerOperations.length = 0;
    clearRequests();
    includeRouterFixture = true;
    try {
      const activation = await request("/api/mpesa/hotspot-mac-access", {
        method: "POST",
        body: {
          checkout_id: assignedTransaction.reference,
          mac_address: assignedCustomer.mac_address,
        },
      });
      assert.equal(activation.status, 200, await activation.clone().text());
      const body = await activation.json() as {
        ok: boolean;
        credentials?: { username: string };
        connected?: boolean;
      };
      assert.equal(body.ok, true);
      assert.equal(body.credentials?.username, assignedCustomer.username);
      assert.equal(body.connected, true);
      assert.deepEqual(routerOperations.filter(row => row.name === "disconnectUser"), []);
      assertAssignedRouterOperations();
    } finally {
      includeRouterFixture = false;
    }
  });

  await t.test("portal login handoff provisions access without starting an API-side router session", async () => {
    transactions = [{ ...assignedTransaction }];
    customers = [{ ...assignedCustomer }];
    routerOperations.length = 0;
    clearRequests();
    includeRouterFixture = true;
    try {
      const activation = await request("/api/mpesa/hotspot-mac-access", {
        method: "POST",
        body: {
          checkout_id: assignedTransaction.reference,
          mac_address: assignedCustomer.mac_address,
          portal_login_handoff: true,
        },
      });
      assert.equal(activation.status, 200, await activation.clone().text());
      const body = await activation.json() as {
        ok: boolean;
        connected?: boolean;
        portal_login_handoff?: boolean;
        credentials?: { username?: string };
      };
      assert.equal(body.ok, true);
      assert.equal(body.connected, false);
      assert.equal(body.portal_login_handoff, true);
      assert.equal(body.credentials?.username, assignedCustomer.username);
      assert.deepEqual(routerOperations.filter(row => row.name === "connectUser"), []);
      assert.deepEqual(routerOperations.filter(row => row.name === "disconnectUser"), []);
      const expiryUpdateIndex = routerOperations.findIndex(row => row.name === "scheduleExpiry");
      const accountUpdateIndex = routerOperations.findIndex(row => row.name === "upsertUser");
      assert.ok(expiryUpdateIndex >= 0 && accountUpdateIndex >= 0 && expiryUpdateIndex < accountUpdateIndex,
        "extend expiry before updating the paid RouterOS account");
      assert.deepEqual(routerOperations.filter(row => row.name === "ensurePool"), [{
        name: "ensurePool",
        server: "HS_RS19_VLAN143",
        pool: "HS_POOL_RS19_VLAN143",
      }]);
      assert.ok(routerOperations.some(row => row.name === "scheduleExpiry"),
        "the handoff must preserve RouterOS expiry enforcement");

      routerOperations.length = 0;
      clearRequests();
      const targetDevice = await request("/api/mpesa/hotspot-mac-access", {
        method: "POST",
        body: {
          checkout_id: assignedTransaction.reference,
          mac_address: assignedCustomer.mac_address,
          portal_login_handoff: true,
          target_device: true,
        },
      });
      assert.equal(targetDevice.status, 200, await targetDevice.clone().text());
      const targetBody = await targetDevice.json() as {
        connected?: boolean;
        portal_login_handoff?: boolean;
      };
      assert.equal(targetBody.connected, true);
      assert.equal(targetBody.portal_login_handoff, false);
      assert.ok(routerOperations.some(row => row.name === "connectUser"),
        "a target-device purchase must keep the direct router-login path");
    } finally {
      includeRouterFixture = false;
    }
  });

  await t.test("typed M-Pesa receipt reconnects only its purchased device on the assigned VLAN Hotspot service", async () => {
    transactions = [{ ...assignedTransaction }];
    customers = [{ ...assignedCustomer }];
    routerOperations.length = 0;
    clearRequests();
    includeRouterFixture = true;
    try {
      const reconnect = await request("/api/mpesa/verify", {
        method: "POST",
        body: {
          message: assignedTransaction.mpesa_receipt,
          mac_address: assignedCustomer.mac_address,
          client_ip: assignedCustomer.ip_address,
        },
      });
      assert.equal(reconnect.status, 200, await reconnect.clone().text());
      const body = await reconnect.json() as {
        ok: boolean;
        credentials?: { username: string };
        connected?: boolean;
      };
      assert.equal(body.ok, true);
      assert.equal(body.credentials?.username, assignedCustomer.username);
      assert.equal(body.connected, true);
      assertAssignedRouterOperations();
    } finally {
      includeRouterFixture = false;
    }
  });

  await t.test("typed receipt completes an unlinked paid account only after the router confirms its MAC", async () => {
    transactions = [{ ...assignedTransaction, customer_id: null }];
    customers = [];
    routerOperations.length = 0;
    clearRequests();
    includeRouterFixture = true;
    try {
      resolvedPortalClientMac = "11:22:33:44:55:66";
      const wrongLiveDevice = await request("/api/mpesa/verify", {
        method: "POST",
        body: {
          message: assignedTransaction.mpesa_receipt,
          mac_address: assignedCustomer.mac_address,
          client_ip: assignedCustomer.ip_address,
        },
      });
      assert.equal(wrongLiveDevice.status, 403);
      assert.ok(routerOperations.some(row => row.name === "resolveClientMac"));
      assert.equal(routerOperations.some(row => row.name === "upsertUser"), false);

      resolvedPortalClientMac = "AA:BB:CC:DD:EE:FF";
      routerOperations.length = 0;
      clearRequests();
      const verified = await request("/api/mpesa/verify", {
        method: "POST",
        body: {
          message: assignedTransaction.mpesa_receipt,
          mac_address: assignedCustomer.mac_address,
          client_ip: assignedCustomer.ip_address,
        },
      });
      assert.equal(verified.status, 200, await verified.clone().text());
      const verification = await verified.json() as {
        ok: boolean;
        account_setup_required?: boolean;
        checkout_id?: string;
      };
      assert.equal(verification.ok, true);
      assert.equal(verification.account_setup_required, true);
      assert.equal(verification.checkout_id, assignedTransaction.reference);
      assert.deepEqual(routerOperations.map(row => row.name), ["resolveClientMac"]);

      const activation = await request("/api/mpesa/hotspot-mac-access", {
        method: "POST",
        body: {
          checkout_id: verification.checkout_id,
          mac_address: assignedCustomer.mac_address,
          client_ip: assignedCustomer.ip_address,
          portal_login_handoff: true,
        },
      });
      assert.equal(activation.status, 200, await activation.clone().text());
      const activated = await activation.json() as {
        ok: boolean;
        connected?: boolean;
        portal_login_handoff?: boolean;
        credentials?: { username: string };
      };
      assert.equal(activated.ok, true);
      assert.equal(activated.connected, false);
      assert.equal(activated.portal_login_handoff, true);
      assert.ok(activated.credentials?.username);
      assert.equal(customers.length, 1);
      assert.equal(transactions[0].customer_id, customers[0].id);
      assert.ok(routerOperations.some(row => row.name === "upsertUser"));
      assert.equal(routerOperations.some(row => row.name === "connectUser"), false);
    } finally {
      resolvedPortalClientMac = "AA:BB:CC:DD:EE:FF";
      includeRouterFixture = false;
    }
  });

  await t.test("manual receipt reconnect requires a saved MAC and a matching live router device", async () => {
    includeRouterFixture = true;
    try {
      transactions = [{ ...assignedTransaction, mac_address: null }];
      customers = [{ ...assignedCustomer, mac_address: null }];
      routerOperations.length = 0;
      clearRequests();
      const unlinked = await request("/api/mpesa/verify", {
        method: "POST",
        body: {
          message: `${assignedTransaction.mpesa_receipt} Confirmed`,
          mac_address: assignedCustomer.mac_address,
          client_ip: assignedCustomer.ip_address,
        },
      });
      assert.equal(unlinked.status, 409);
      assert.equal(routerOperations.length, 0);

      transactions = [{ ...assignedTransaction }];
      customers = [{ ...assignedCustomer }];
      resolvedPortalClientMac = "11:22:33:44:55:66";
      routerOperations.length = 0;
      clearRequests();
      const wrongLiveDevice = await request("/api/mpesa/verify", {
        method: "POST",
        body: {
          message: `${assignedTransaction.mpesa_receipt} Confirmed`,
          mac_address: assignedCustomer.mac_address,
          client_ip: assignedCustomer.ip_address,
        },
      });
      assert.equal(wrongLiveDevice.status, 403);
      assert.ok(routerOperations.some(row => row.name === "resolveClientMac"));
      const mutatingOperations = new Set<string>([
        "ensurePool",
        "addBinding",
        "updateUser",
        "addUser",
        "connectUser",
      ]);
      assert.equal(routerOperations.some(row => mutatingOperations.has(row.name)), false);
    } finally {
      resolvedPortalClientMac = "AA:BB:CC:DD:EE:FF";
      includeRouterFixture = false;
    }
  });

  await t.test("manual receipt reconnect refuses an expired hotspot package", async () => {
    transactions = [{ ...assignedTransaction }];
    customers = [{
      ...assignedCustomer,
      status: "expired",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    }];
    routerOperations.length = 0;
    clearRequests();
    const expired = await request("/api/mpesa/verify", {
      method: "POST",
      body: {
        message: `${assignedTransaction.mpesa_receipt} Confirmed`,
        mac_address: assignedCustomer.mac_address,
        client_ip: assignedCustomer.ip_address,
      },
    });
    assert.equal(expired.status, 409);
    assert.match((await expired.json() as { error: string }).error, /package.*expired/i);
    assert.deepEqual(routerOperations, []);
  });

  await t.test("valid scope resolves its own customer, payment, and router context", async () => {
    customers = [assignedCustomer];
    clearRequests();
    const login = await request("/api/customers/hotspot-login", {
      method: "POST",
      body: { username: "assigned-account", password: "assigned-password" },
    });
    assert.equal(login.status, 409, "fixture has no RouterOS router row, but the assigned customer must pass scope checks");
    assert.ok(dbRequests.some(row => row.table === "isp_customers"
      && row.rawQuery.includes("admin_id=eq.19")
      && row.rawQuery.includes("router_id=eq.31")
      && row.rawQuery.includes("port_id=eq.43")));
    assert.ok(dbRequests.some(row => row.table === "isp_routers"
      && row.rawQuery.includes("id=eq.31")
      && row.rawQuery.includes("admin_id=eq.7")));

    transactions = [assignedTransaction];
    clearRequests();
    const status = await request("/api/mpesa/status?checkout_id=assigned-checkout");
    assert.equal(status.status, 200);
    assert.equal((await status.json() as { paid: boolean }).paid, true);
    assert.ok(dbRequests.some(row => row.table === "isp_plans"
      && row.rawQuery.includes("id=eq.501")
      && row.rawQuery.includes("router_id=eq.31")
      && row.rawQuery.includes("port_id=eq.43")
      && row.rawQuery.includes("owner_reseller_id=eq.19")));

    clearRequests();
    const troubleshoot = await request("/api/customers/hotspot-troubleshoot", {
      method: "POST",
      body: { action: "check", mac_address: "AA:BB:CC:DD:EE:FF" },
    });
    assert.equal(troubleshoot.status, 200);
    const troubleshooting = await troubleshoot.json() as { found: boolean; status: string; planName: string };
    assert.equal(troubleshooting.found, true);
    assert.equal(troubleshooting.status, "active");
    assert.equal(troubleshooting.planName, assignedPlan.name);
    assert.equal(dbRequests.some(row => row.table === "isp_routers"), false);
  });

  await t.test("portal expiry checks skip router quota reads", async () => {
    const originalDataCapMode = assignedPlan.data_cap_mode;
    assignedPlan.data_cap_mode = "disconnect";
    transactions = [{ ...assignedTransaction }];
    customers = [{ ...assignedCustomer, fup_limit_mb: 1000 }];
    routerOperations.length = 0;
    clearRequests();
    includeRouterFixture = true;
    try {
      const expiryCheck = await request("/api/customers/hotspot-troubleshoot", {
        method: "POST",
        body: {
          action: "check",
          expiry_only: true,
          mac_address: assignedCustomer.mac_address,
        },
      });
      assert.equal(expiryCheck.status, 200, await expiryCheck.clone().text());
      assert.equal((await expiryCheck.json() as { status: string }).status, "active");
      assert.equal(routerOperations.some(row => row.name === "readUsage"), false);
      assert.equal(dbRequests.some(row => row.table === "isp_routers"), false);
    } finally {
      assignedPlan.data_cap_mode = originalDataCapMode;
      includeRouterFixture = false;
    }
  });

  await t.test("sibling customer login and troubleshooting do not reach router lookups", async () => {
    customers = [siblingCustomer];
    clearRequests();
    const login = await request("/api/customers/hotspot-login", {
      method: "POST",
      body: { username: "sibling-account", password: "not-returned" },
    });
    assert.equal(login.status, 401);
    assert.ok(dbRequests.some(row => row.table === "isp_customers"
      && row.rawQuery.includes("admin_id=eq.7")
      && row.rawQuery.includes("router_id=eq.31")
      && row.rawQuery.includes("port_id=eq.43")));
    assertNoRouterOrWrites();

    transactions = [siblingTransaction];
    clearRequests();
    const troubleshoot = await request("/api/customers/hotspot-troubleshoot", {
      method: "POST",
      body: { action: "login", mac_address: "AA:BB:CC:DD:EE:FF" },
    });
    assert.equal(troubleshoot.status, 200);
    const troubleshooting = await troubleshoot.json() as { found: boolean; status: string };
    assert.equal(troubleshooting.found, false);
    assert.equal(troubleshooting.status, "not_found");
    assert.ok(dbRequests.some(row => row.table === "isp_plans"
      && row.rawQuery.includes("router_id=eq.31")
      && row.rawQuery.includes("port_id=eq.43")));
    assertNoRouterOrWrites();
  });

  await t.test("sibling payments are hidden before reconnect or activation", async () => {
    transactions = [siblingTransaction];
    customers = [siblingCustomer];

    clearRequests();
    const status = await request("/api/mpesa/status?checkout_id=sibling-checkout");
    assert.equal(status.status, 404);
    assert.equal((await status.json() as { paid: boolean }).paid, false);
    assertNoRouterOrWrites();

    clearRequests();
    const verify = await request("/api/mpesa/verify", {
      method: "POST",
      body: { message: "AB12345678 Confirmed", mac_address: "AA:BB:CC:DD:EE:FF" },
    });
    assert.ok([404, 409].includes(verify.status));
    const verifyBody = await verify.json() as Record<string, unknown>;
    assert.equal(verifyBody.credentials, undefined);
    assert.ok(dbRequests.some(row => row.table === "isp_customers"
      && row.rawQuery.includes("router_id=eq.31")
      && row.rawQuery.includes("port_id=eq.43")));
    assertNoRouterOrWrites();

    clearRequests();
    const activation = await request("/api/mpesa/hotspot-mac-access", {
      method: "POST",
      body: {
        checkout_id: "sibling-checkout",
        adminId: 7,
        router_id: 31,
        port_id: 43,
        mac_address: "AA:BB:CC:DD:EE:FF",
      },
    });
    assert.equal(activation.status, 409);
    assert.ok(dbRequests.some(row => row.table === "isp_plans"
      && row.rawQuery.includes("router_id=eq.31")
      && row.rawQuery.includes("port_id=eq.43")
      && row.rawQuery.includes("owner_reseller_id=eq.19")));
    assertNoRouterOrWrites();
  });

  await t.test("sibling plan checkout is rejected, while assigned device and payment settings stay scoped", async () => {
    clearRequests();
    const intent = await request("/api/mpesa/intent", {
      method: "POST",
      body: {
        adminId: 7,
        plan_id: siblingPlan.id,
        phone: "0700000000",
        router_id: 31,
        port_id: 43,
        mac_address: "AA:BB:CC:DD:EE:FF",
      },
    });
    assert.equal(intent.status, 409);
    assertNoRouterOrWrites();

    clearRequests();
    const paymentIntent = generatePaymentIntent({
      adminId: 7,
      planId: siblingPlan.id,
      amount: Number(siblingPlan.price),
      phone: "254700000000",
      serviceType: "hotspot",
      routerId: 31,
      portId: 43,
      macAddress: "AA:BB:CC:DD:EE:FF",
    });
    const stk = await request("/api/mpesa/stk", {
      method: "POST",
      body: {
        adminId: 7,
        plan_id: siblingPlan.id,
        amount: siblingPlan.price,
        phone: "0700000000",
        paymentIntent,
        service_type: "hotspot",
        router_id: 31,
        port_id: 43,
        mac_address: "AA:BB:CC:DD:EE:FF",
      },
    });
    assert.equal(stk.status, 409);
    assertNoRouterOrWrites();

    clearRequests();
    const siblingDevice = await request("/api/mpesa/hotspot-devices?adminId=7&routerId=32");
    assert.equal(siblingDevice.status, 403);
    assert.equal(dbRequests.some(row => row.table === "isp_routers"), false);

    clearRequests();
    const devices = await request("/api/mpesa/hotspot-devices?adminId=7&routerId=31");
    assert.equal(devices.status, 200);
    assert.deepEqual((await devices.json() as { devices: unknown[] }).devices, []);
    assert.ok(dbRequests.some(row => row.table === "isp_routers"
      && row.rawQuery.includes("id=eq.31")
      && row.rawQuery.includes("admin_id=eq.7")));

    clearRequests();
    const settings = await request("/api/settings/mpesa?routerId=31&portId=43");
    assert.equal(settings.status, 200);
    const settingsBody = await settings.json() as {
      configured: boolean;
      settings: {
        shortcode: string;
        paymentGateway: string;
        destinationConfigured: boolean;
        adminTillPushConfigured: boolean;
      };
    };
    assert.equal(settingsBody.configured, false);
    assert.equal(settingsBody.settings.paymentGateway, "");
    assert.equal(settingsBody.settings.destinationConfigured, false);
    assert.equal(settingsBody.settings.adminTillPushConfigured, false);
    assert.equal(settingsBody.settings.shortcode, "");
    assert.ok(dbRequests.some(row => row.table === "reseller_payment_gateway_routes"
      && row.rawQuery.includes("reseller_id=eq.19")
      && row.rawQuery.includes("router_id.eq.31")
      && row.rawQuery.includes("port_id.eq.43")));
  });

  await t.test("requests without a portal token keep legacy payment-status behavior", async () => {
    legacyCheckout = true;
    clearRequests();
    const response = await request("/api/mpesa/status?checkout_id=legacy-checkout", { token: null });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { paid: boolean }).paid, true);
    const transactionLookup = dbRequests.find(row => row.table === "isp_transactions");
    assert.ok(transactionLookup);
    assert.equal(transactionLookup.query.has("admin_id"), false);
    assert.equal(dbRequests.some(row => row.table === "isp_reseller_ports"), false);
    legacyCheckout = false;

    customers = [{
      ...assignedCustomer,
      admin_id: 7,
    }];
    clearRequests();
    const login = await request("/api/customers/hotspot-login", {
      method: "POST",
      token: null,
      body: { adminId: 7, username: "assigned-account", password: "assigned-password" },
    });
    assert.equal(login.status, 409);
    const customerLookup = dbRequests.find(row => row.table === "isp_customers");
    assert.ok(customerLookup);
    assert.equal(customerLookup.query.has("router_id"), false);
    assert.equal(customerLookup.query.has("port_id"), false);
  });
});