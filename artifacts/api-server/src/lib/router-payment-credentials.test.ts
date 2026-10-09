import assert from "node:assert/strict";
import { test } from "node:test";
import {
  paymentRouterConnectionCredentials,
  routerManagementVpnIpFor,
} from "./router-payment-credentials.js";

test("router management address discovery prefers the currently connected VPN IP", () => {
  assert.equal(
    routerManagementVpnIpFor(
      {
        name: "Alistwifi1",
        host: "198.51.100.18",
        vpn_ip: "10.8.5.16",
      },
      [{ cn: "Alistwifi1", vpnIp: "10.8.5.21", realIp: "198.51.100.18" }],
    ),
    "10.8.5.21",
  );
});

test("router management address discovery falls back to the saved VPN IP", () => {
  assert.equal(
    routerManagementVpnIpFor(
      { name: "Alistwifi1", vpn_ip: "10.8.5.16" },
      [],
    ),
    "10.8.5.16",
  );
});

test("payment provisioning prefers the connected management VPN and management API account", () => {
  assert.deepEqual(
    paymentRouterConnectionCredentials(
      {
        name: "Alistwifi1",
        host: "198.51.100.18",
        vpn_ip: "10.8.5.16",
        router_username: "alistwifi1",
        router_secret: "router-secret",
      },
      [{ cn: "Alistwifi1", vpnIp: "10.8.5.21", realIp: "198.51.100.18" }],
    ),
    {
      host: "10.8.5.21",
      port: 8728,
      username: "ocholasupernet",
      password: "router-secret",
      useSSL: false,
      bridgeIp: "10.8.5.21",
      alternateUsernames: ["alistwifi1"],
    },
  );
});

test("payment provisioning keeps the saved account for a non-management connection", () => {
  assert.deepEqual(
    paymentRouterConnectionCredentials(
      {
        name: "Alistwifi1",
        host: "198.51.100.18",
        bridge_ip: "192.168.88.1",
        router_username: "alistwifi1",
        router_secret: "router-secret",
      },
      [],
    ),
    {
      host: "198.51.100.18",
      port: 8728,
      username: "alistwifi1",
      password: "router-secret",
      useSSL: false,
      bridgeIp: "192.168.88.1",
      alternateUsernames: undefined,
    },
  );
});

test("payment provisioning retains the stored management VPN when status has no live client", () => {
  const credentials = paymentRouterConnectionCredentials(
    {
      name: "Alistwifi1",
      host: "198.51.100.18",
      vpn_ip: "10.8.5.16",
      router_username: "alistwifi1",
      router_secret: "router-secret",
    },
    [],
  );

  assert.equal(credentials.host, "10.8.5.16");
  assert.equal(credentials.username, "ocholasupernet");
  assert.deepEqual(credentials.alternateUsernames, ["alistwifi1"]);
});
