import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenVpnStatus, vpnIpFor, type VpnClient } from "./vpn-status.js";

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

test("parses v2 status rows for both primary and backup management pools", () => {
  const parsed = parseOpenVpnStatus([
    "TITLE,OpenVPN 2.6.0",
    "HEADER,CLIENT_LIST,Common Name,Real Address,Virtual Address,Bytes Received",
    "CLIENT_LIST,router-primary,198.51.100.12:41000,10.8.5.16,1234",
    "HEADER,ROUTING_TABLE,Virtual Address,Common Name,Real Address,Last Ref",
    "ROUTING_TABLE,10.8.5.16,router-primary,198.51.100.12:41000,2026-10-28 10:00:00",
    "ROUTING_TABLE,10.8.6.22,router-backup,203.0.113.44:42000,2026-10-28 10:01:00",
    "GLOBAL_STATS,Max bcast/mcast queue length,0",
    "END",
  ].join("\n"));

  assert.deepEqual(parsed, [
    { cn: "router-primary", vpnIp: "10.8.5.16", realIp: "198.51.100.12" },
    { cn: "router-backup", vpnIp: "10.8.6.22", realIp: "203.0.113.44" },
  ]);
});

test("parses legacy section-based status rows and ignores non-routing records", () => {
  const parsed = parseOpenVpnStatus([
    "TITLE,OpenVPN 2.3.18",
    "OpenVPN CLIENT LIST",
    "Common Name,Real Address,Bytes Received",
    "router-primary,198.51.100.12:41000,1234",
    "ROUTING TABLE",
    "Virtual Address,Common Name,Real Address,Last Ref",
    "10.8.5.16,router-primary,198.51.100.12:41000,Wed Oct 28 10:00:00 2026",
    "GLOBAL STATS",
    "END",
  ].join("\n"));

  assert.deepEqual(parsed, [
    { cn: "router-primary", vpnIp: "10.8.5.16", realIp: "198.51.100.12" },
  ]);
});
