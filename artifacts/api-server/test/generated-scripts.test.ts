import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";

import {
  generateOvpnClientConfig,
  generateRouterAsClientScript,
  generateVpnSetupScript,
} from "../src/lib/mikrotik.ts";
import { generateVpsOvpnSetupScript } from "../src/lib/vpn-utils.ts";

process.env.VITE_SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const { default: pppoeRouter, genPPPoEOnly, genPPPoEOverHotspot, genPPPoEVlan } =
  await import("../src/routes/pppoe-script-route.ts");
const { default: scriptsRouter } = await import("../src/routes/scripts-route.ts");

const httpFetch = globalThis.fetch;

const routerRecord = {
  id: 42,
  name: "Edge Router",
  host: "203.0.113.42",
  status: "offline",
  router_username: "router-api",
  router_secret: "edge-secret",
  ros_version: "7.15",
  ports: "ether1,ether2",
  wan_interface: "ether1",
  bridge_interface: "hotspot-bridge",
  bridge_ip: "192.168.178.1",
  hotspot_dns_name: "wifi.edge.test",
  pppoe_mode: null,
  admin_id: 12,
};

type SupabaseHandler = (url: string, init?: RequestInit) => unknown;

function stubSupabase(handler: SupabaseHandler): () => void {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith("https://supabase.test/")) {
      return httpFetch(input, init);
    }

    if (init?.method === "POST") {
      return new Response("", { status: 201 });
    }

    const body = await handler(url, init);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  return () => {
    globalThis.fetch = previousFetch;
  };
}

async function get(
  router: express.Router,
  path: string,
  host = "localhost",
): Promise<{ status: number; body: string; headers: Headers }> {
  const app = express();
  app.use((request, _response, next) => {
    request.headers.host = host;
    next();
  });
  app.use(router);
  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await httpFetch(`http://127.0.0.1:${address.port}${path}`, {
      headers: { host },
    });
    return {
      status: response.status,
      body: await response.text(),
      headers: response.headers,
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function assertRuntimeVariables(script: string, variables: string[]): void {
  for (const variable of variables) {
    assert.match(
      script,
      new RegExp(`\\$${variable}\\b`),
      `${variable} must remain a RouterOS/shell runtime variable`,
    );
  }
}

test("VPS OpenVPN setup keeps shell variables runtime-evaluated", () => {
  const script = generateVpsOvpnSetupScript({
    vpsPublicIp: "198.51.100.10",
    vpnPort: 443,
    vpnUsername: "edge-router",
    vpnPassword: "runtime-password",
    tunnelBase: "10.8.7",
    routerTunnelIp: "10.8.7.2",
    routerId: 42,
  });

  assert.match(script, /^#!\/usr\/bin\/env bash/);
  assert.match(script, /cp "\$OVPN_CONF" "\$\{OVPN_CONF\}\.bak\.\$\(date \+%s\)"/);
  assert.match(script, /AUTHFILE="\$OVPN_DIR\/passwd"/);
  assert.match(script, /grep -qF "\$\{username\}:\$\{password\}"/);
  assert.match(script, /iptables -I INPUT -p tcp --dport 443/);
  assert.match(script, /ifconfig-push 10\.8\.7\.2 10\.8\.7\.1/);
  assertRuntimeVariables(script, ["OVPN_CONF", "OVPN_DIR", "AUTHFILE", "AUTHSCRIPT"]);
});

test("RouterOS VPN generators preserve runtime error variables and required commands", () => {
  const vpnServer = generateVpnSetupScript({
    routerPublicIp: "198.51.100.20",
    vpsIp: "198.51.100.10",
    vpnPort: 1195,
    vpnUsername: "edge",
    vpnPassword: "secret",
    tunnelNetwork: "192.168.99",
    lanNetwork: "192.168.77.0/24",
    routerId: 42,
  });
  const ovpn = generateOvpnClientConfig({
    routerPublicIp: "198.51.100.20",
    vpnPort: 1195,
    vpnUsername: "edge",
    vpnPassword: "secret",
    lanNetwork: "192.168.77.0/24",
    routeAll: false,
  });
  const routerClient = generateRouterAsClientScript({
    vpsPublicIp: "198.51.100.10",
    vpnPort: 1195,
    vpnUsername: "edge",
    vpnPassword: "secret",
    tunnelRouterIp: "10.8.7.2",
    tunnelVpsIp: "10.8.7.1",
    routerId: 42,
  });

  assert.match(vpnServer, /protocol=tcp/);
  assert.match(vpnServer, /src-address=198\.51\.100\.10/);
  assert.match(vpnServer, /dst-port=8728,8729/);
  assert.match(vpnServer, /comment="ISP-42-api-from-vpn"/);
  assert.match(ovpn, /route-nopull/);
  assert.match(ovpn, /route 192\.168\.77\.0 255\.255\.255\.0/);
  assert.match(routerClient, /add name=ovpn-to-vps/);
  assert.match(routerClient, /connect-to=198\.51\.100\.10/);
  assert.match(routerClient, /src-address=10\.8\.7\.1\/32/);

  assert.match(vpnServer, /\/interface ovpn-server server/);
  assert.match(routerClient, /\/ip service\s*\n?enable api/);
});

test("PPPoE generators cover only, hotspot, and VLAN variants", () => {
  const only = genPPPoEOnly(routerRecord, "Edge ISP", 6, "edge");
  const hotspot = genPPPoEOverHotspot(routerRecord, "Edge ISP", 7, "edge");
  const vlan = genPPPoEVlan(
    routerRecord,
    "Edge ISP",
    7,
    "edge",
    300,
    "core-bridge",
    "172.20.30.1",
    "https://edge.isplatty.org/api/scripts/vlanpppoe/42.rsc",
  );

  assert.match(only, /\/interface pppoe-server server add/);
  assert.match(only, /interface=bridge-pppoe/);
  assert.match(only, /https:\/\/edge\.isplatty\.org\/api\/pppoe-script\/42\/pppoe_only/);
  assert.match(hotspot, /PPPoE-over-Hotspot applied/);
  assert.match(hotspot, /\/ip hotspot/);
  assert.match(hotspot, /10\.20\.0\.10-10\.20\.0\.254/);
  assert.match(vlan, /\/interface vlan add name=vlan300 vlan-id=300 interface=core-bridge/);
  assert.match(vlan, /172\.20\.30\.1\/24/);
  assert.match(vlan, /https:\/\/edge\.isplatty\.org\/api\/scripts\/vlanpppoe\/42\.rsc/);
  assertRuntimeVariables(only, ["rosVer"]);
  assertRuntimeVariables(hotspot, ["rosVer"]);
  assertRuntimeVariables(vlan, ["rosVer"]);
});

test("PPPoE route returns validation, not-found, and generated variant responses", async () => {
  let restore = stubSupabase(() => []);
  try {
    const invalid = await get(pppoeRouter, "/pppoe-script/not-a-router/pppoe_only");
    assert.equal(invalid.status, 400);
    assert.match(invalid.body, /invalid routerId or mode/);

    const missing = await get(pppoeRouter, "/pppoe-script/999/pppoe_only");
    assert.equal(missing.status, 404);
    assert.match(missing.body, /router not found/);
  } finally {
    restore();
  }

  restore = stubSupabase((url) => {
    if (url.includes("isp_routers?")) return [routerRecord];
    if (url.includes("isp_admins?")) return [{ id: 12, name: "Edge ISP", subdomain: "edge" }];
    return [];
  });
  try {
    const only = await get(pppoeRouter, "/pppoe-script/42/pppoe_only/6");
    assert.equal(only.status, 200);
    assert.match(only.body, /Content|PPPoE/);
    assert.match(only.body, /RouterOS v/);
    assert.match(only.headers.get("content-disposition") ?? "", /pppoe-only-edge-router\.rsc/);

    const hotspot = await get(pppoeRouter, "/pppoe-script/42/pppoe_over_hotspot/7");
    assert.equal(hotspot.status, 200);
    assert.match(hotspot.body, /PPPoE-over-Hotspot applied/);

    const vlan = await get(
      pppoeRouter,
      "/pppoe-script/42/pppoe_vlan/7/300/core-bridge",
    );
    assert.equal(vlan.status, 200);
    assert.match(vlan.body, /vlan-id=300/);
    assert.match(vlan.body, /interface=core-bridge/);
    assert.match(vlan.headers.get("content-disposition") ?? "", /vlanpppoe-edge-router\.rsc/);
  } finally {
    await new Promise((resolve) => setImmediate(resolve));
    restore();
  }
});

test("main script responses select RouterOS 6/7 assets and keep runtime variables", async () => {
  let restore = stubSupabase((url) => {
    if (url.includes("isp_admins?")) return [{ id: 12, name: "Edge ISP", subdomain: "edge" }];
    return [];
  });
  try {
    const vpn7 = await get(scriptsRouter, "/scripts/vpn7.rsc", "edge.isplatty.org");
    assert.equal(vpn7.status, 200);
    assert.match(vpn7.body, /connect-to="edge\.isplatty\.org"/);
    assert.match(vpn7.body, /verify-server-certificate=no/);
    assert.match(vpn7.body, /\/interface ovpn-client add/);

    const vpn6 = await get(scriptsRouter, "/scripts/vpn6.rsc", "edge.isplatty.org");
    assert.equal(vpn6.status, 200);
    assert.match(vpn6.body, /connect-to="edge\.isplatty\.org"/);
    assert.doesNotMatch(vpn6.body, /verify-server-certificate=no/);

    const genericMain = await get(scriptsRouter, "/scripts/mainhotspot.rsc", "edge.isplatty.org");
    assert.equal(genericMain.status, 200);
    assert.match(genericMain.body, /https:\/\/edge\.isplatty\.org\/scripts\/vpn7\.rsc/);
    assert.match(genericMain.body, /:if \(\$majorVersion = 7\)/);
    assertRuntimeVariables(genericMain.body, ["version", "vpnUrl", "failures"]);
  } finally {
    restore();
  }

  restore = stubSupabase((url) => {
    if (url.includes("isp_routers?")) return [{ admin_id: 12, name: "Edge Router" }];
    if (url.includes("isp_admins?")) return [{ id: 12, name: "Edge ISP", subdomain: "edge" }];
    return [];
  });
  try {
    const personalized = await get(
      scriptsRouter,
      "/scripts/mainhotspot.rsc?rid=42&token=edge_secret-42&name=ignored",
      "edge.isplatty.org",
    );
    assert.equal(personalized.status, 200);
    assert.match(personalized.body, /Edge ISP router setup/);
    assert.match(personalized.body, /Edge Router/);
    assert.match(personalized.body, /install-progress\/42\?token=edge_secret-42/);
    assert.match(personalized.body, /\/api\/isp\/router\/register\/edge_secret-42/);
    assertRuntimeVariables(personalized.body, ["IPProgUrl", "IPRname"]);
  } finally {
    restore();
  }
});