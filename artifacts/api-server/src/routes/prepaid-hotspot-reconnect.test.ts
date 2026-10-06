import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

process.env.SESSION_SECRET = "prepaid-hotspot-reconnect-test-secret";
process.env.VITE_SUPABASE_URL = "https://prepaid-hotspot-reconnect-test.supabase.co";
process.env.VITE_SUPABASE_KEY = "prepaid-hotspot-reconnect-test-anon";
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_SERVICE_KEY;

const account = { id: 7, parent_id: null, role: "isp_admin", is_active: true };
const customerFixture = {
  id: 801,
  admin_id: 7,
  name: "Test prepaid user",
  phone: "254700000001",
  mac_address: "AA:BB:CC:DD:EE:FF",
  username: "254700000001",
  password: "saved-router-password",
  type: "hotspot",
  plan_id: 503,
  router_id: 31,
  port_id: 45,
  ip_address: null,
  status: "active",
  expires_at: "2027-09-29T00:00:00.000Z",
  fup_limit_mb: null,
  depletion_reason: null,
};
const planFixture = {
  id: 503,
  admin_id: 7,
  name: "One-hour Hotspot",
  type: "hotspot",
  is_active: true,
  router_id: 31,
  port_id: 45,
  owner_reseller_id: null,
  speed_down: 10,
  speed_up: 5,
  speed_down_unit: "Mbps",
  speed_up_unit: "Mbps",
  data_limit_mb: 1,
  data_cap_mode: "disconnect",
  fup_speed_down: null,
  fup_speed_up: null,
  shared_users: 1,
};
const routerFixture = {
  id: 31,
  admin_id: 7,
  name: "edge-1",
  host: "198.51.100.31",
  bridge_ip: null,
  vpn_ip: "10.8.5.31",
  router_username: "router-api",
  router_secret: "router-test-secret",
};
const portFixture = {
  id: 45,
  admin_id: 7,
  router_id: 31,
  interface_name: "ether2",
  bridge_name: "br-main",
  handoff_mode: "services",
  reseller_id: null,
  assigned_reseller_id: null,
  vlan_tag: null,
  subnet_range: "10.45.0.0/24",
  status: "active",
  hotspot_enabled: true,
  link_status: "active",
};

type FakeRequest = {
  table: string;
  method: string;
  query: URLSearchParams;
  body?: Record<string, unknown>;
};

function matches(row: Record<string, unknown>, query: URLSearchParams): boolean {
  for (const [key, filter] of query) {
    if (["select", "limit", "order"].includes(key)) continue;
    const value = row[key];
    if (filter.startsWith("eq.")) {
      if (String(value ?? "") !== filter.slice(3)) return false;
    } else if (filter === "is.null" && value !== null) {
      return false;
    } else if (filter === "is.true" && value !== true) {
      return false;
    } else if (filter.startsWith("in.(")) {
      if (!filter.slice(4, -1).split(",").includes(String(value))) return false;
    }
  }
  return true;
}

test("prepaid Hotspot reconnect safely restores and logs in one entitled device", async t => {
  const [
    { generateAdminSessionToken },
    { default: customersRouter, prepaidHotspotReconnectOperations },
  ] = await Promise.all([
    import("../lib/api-auth.js"),
    import("./customers.js"),
  ]);

  const app = express();
  app.use(express.json());
  app.use("/api", customersRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch;
  const originalOperations = { ...prepaidHotspotReconnectOperations };
  let customers: Record<string, unknown>[] = [{ ...customerFixture }];
  let routerManagementIp: string | null = "10.8.5.31";
  let usageBytes = 0;
  let clientIp: string | null = "10.45.0.20";
  let activeSessions: Array<{
    id: string;
    user: string;
    address: string;
    macAddress: string;
    uptime: string;
    bytesIn: number;
    bytesOut: number;
    server: string;
  }> = [];
  const routerCalls: Array<{ action: string; [key: string]: unknown }> = [];

  prepaidHotspotReconnectOperations.withCustomerEditLock = async (_adminId, _customerId, operation) =>
    operation(async () => {});
  prepaidHotspotReconnectOperations.fetchHotspotUsers = async creds => {
    routerCalls.push({ action: "read-sessions", host: creds.host });
    return activeSessions;
  };
  prepaidHotspotReconnectOperations.fetchHotspotUserUsage = async (_creds, username) => {
    routerCalls.push({ action: "read-usage", username });
    return { bytesIn: usageBytes, bytesOut: 0, disabled: false };
  };
  prepaidHotspotReconnectOperations.resolveHotspotClientIpByMac = async (_creds, mac) => {
    routerCalls.push({ action: "find-device", mac });
    return clientIp;
  };
  prepaidHotspotReconnectOperations.reconcileHotspotUserAccess = async (_creds, options) => {
    routerCalls.push({
      action: "reconcile",
      username: options.name,
      server: options.server,
      enabled: options.enabled,
      address: options.address,
      resetCounters: options.resetCounters,
    });
  };
  prepaidHotspotReconnectOperations.connectHotspotUser = async (_creds, options) => {
    routerCalls.push({
      action: "connect",
      username: options.user,
      server: options.server,
      macAddress: options.macAddress,
    });
    return true;
  };

  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "127.0.0.1") return originalFetch(input, init);
    assert.equal(url.hostname, "prepaid-hotspot-reconnect-test.supabase.co");
    const table = url.pathname.split("/").at(-1) ?? "";
    const query = new URLSearchParams(url.search);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string"
      ? JSON.parse(init.body) as Record<string, unknown>
      : undefined;
    const request: FakeRequest = { table, method, query, ...(body ? { body } : {}) };

    let rows: Record<string, unknown>[] = [];
    if (table === "isp_admins") {
      rows = [account].filter(row => matches(row, query));
    } else if (table === "isp_customers") {
      rows = customers.filter(row => matches(row, query));
    } else if (table === "isp_plans") {
      rows = [planFixture].filter(row => matches(row, query));
    } else if (table === "isp_routers") {
      rows = [{ ...routerFixture, vpn_ip: routerManagementIp }].filter(row => matches(row, query));
    } else if (table === "isp_reseller_ports") {
      rows = [portFixture].filter(row => matches(row, query));
    } else if (table === "isp_hotspot_roaming_rules") {
      rows = [];
    }
    if (method === "PATCH" && body) {
      for (const row of rows) Object.assign(row, body);
    }
    void request;
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  t.after(async () => {
    globalThis.fetch = originalFetch;
    Object.assign(prepaidHotspotReconnectOperations, originalOperations);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  const adminToken = generateAdminSessionToken("7", 1);
  const postReconnect = () => originalFetch(`${origin}/api/customers/801/hotspot-reconnect`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  const unauthorized = await originalFetch(`${origin}/api/customers/801/hotspot-reconnect`, {
    method: "POST",
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(routerCalls.length, 0);

  routerManagementIp = null;
  const missingManagementVpn = await postReconnect();
  assert.equal(missingManagementVpn.status, 503);
  assert.equal((await missingManagementVpn.json() as { status: string }).status, "router_unavailable");
  assert.equal(routerCalls.length, 0);
  routerManagementIp = "10.8.5.31";

  const connected = await postReconnect();
  assert.equal(connected.status, 200, await connected.clone().text());
  const connectedResult = await connected.json() as { status: string; message: string };
  assert.equal(connectedResult.status, "connected");
  assert.match(connectedResult.message, /reconnected/i);
  assert.equal(JSON.stringify(connectedResult).includes(customerFixture.password), false);
  const reconcile = routerCalls.find(call => call.action === "reconcile");
  const connect = routerCalls.find(call => call.action === "connect");
  assert.equal(reconcile?.enabled, true);
  assert.equal(reconcile?.resetCounters, false);
  assert.equal(reconcile?.address, "10.45.0.20");
  assert.equal(typeof reconcile?.server, "string");
  assert.equal(connect?.username, customerFixture.username);
  assert.equal(connect?.macAddress, customerFixture.mac_address);
  assert.equal(typeof connect?.server, "string");

  customers = [{ ...customerFixture, status: "suspended" }];
  routerCalls.length = 0;
  const suspended = await postReconnect();
  assert.equal(suspended.status, 200);
  assert.equal((await suspended.json() as { status: string }).status, "not_eligible");
  assert.equal(routerCalls.length, 0);

  customers = [{ ...customerFixture }];
  clientIp = null;
  routerCalls.length = 0;
  const deviceNotVisible = await postReconnect();
  assert.equal(deviceNotVisible.status, 200);
  assert.equal((await deviceNotVisible.json() as { status: string }).status, "device_not_found");
  assert.equal(routerCalls.some(call => call.action === "reconcile" || call.action === "connect"), false);

  clientIp = "10.45.0.20";
  activeSessions = [{
    id: "*1",
    user: customerFixture.username,
    address: "10.45.0.20",
    macAddress: customerFixture.mac_address,
    uptime: "00:01:00",
    bytesIn: 100,
    bytesOut: 100,
    server: "hotspot",
  }];
  routerCalls.length = 0;
  const alreadyConnected = await postReconnect();
  assert.equal(alreadyConnected.status, 200);
  assert.equal((await alreadyConnected.json() as { status: string }).status, "already_connected");
  assert.equal(routerCalls.some(call => call.action === "connect" || call.action === "reconcile"), false);

  activeSessions = [];
  usageBytes = 10_000_000;
  routerCalls.length = 0;
  const depleted = await postReconnect();
  assert.equal(depleted.status, 200);
  assert.equal((await depleted.json() as { status: string }).status, "depleted");
  assert.equal(routerCalls.some(call => call.action === "connect"), false);
  assert.equal(routerCalls.some(call => call.action === "reconcile" && call.enabled === false), true);
  assert.equal(customers[0].status, "expired");
  assert.equal(customers[0].depletion_reason, "data_limit");
});
