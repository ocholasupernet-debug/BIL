import assert from "node:assert/strict";
import test from "node:test";
import { vpnIpFor, type VpnClient } from "./vpn-status.js";

const clients: VpnClient[] = [
  { cn: "router-a", vpnIp: "10.8.5.16", realIp: "198.51.100.20" },
  { cn: "ocholasupernet2", vpnIp: "10.8.5.18", realIp: "198.51.100.20" },
  { cn: "router-c", vpnIp: "10.8.5.20", realIp: "203.0.113.45" },
];

test("vpnIpFor prefers an exact certificate common name over a shared public IP", () => {
  assert.equal(vpnIpFor("ocholasupernet2", clients), "10.8.5.18");
});

test("vpnIpFor refuses to guess when a public IP belongs to multiple VPN peers", () => {
  assert.equal(vpnIpFor("198.51.100.20", clients), null);
});

test("vpnIpFor still resolves a unique public IP to its VPN tunnel", () => {
  assert.equal(vpnIpFor("203.0.113.45", clients), "10.8.5.20");
});

test("vpnIpFor trims lookup values and returns null for unknown peers", () => {
  assert.equal(vpnIpFor("  router-a  ", clients), "10.8.5.16");
  assert.equal(vpnIpFor("unknown", clients), null);
});
