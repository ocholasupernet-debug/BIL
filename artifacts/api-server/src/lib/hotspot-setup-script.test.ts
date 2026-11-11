import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  configuredHotspotPaymentHosts,
  generateHotspotSetupScript,
  resolveHotspotSetupAdminId,
  type HotspotSetupScriptInput,
} from "./hotspot-setup-script.js";

const base: HotspotSetupScriptInput = {
  routerId: 41,
  bridgeName: "bridge-LAN",
  gatewayCidr: "192.168.180.1/22",
  dhcpPoolName: "hotspot-dhcp-pool",
  dhcpPoolRange: "192.168.180.10-192.168.183.254",
  pppoePoolRanges: ["192.168.185.5-192.168.190.254"],
  dhcpServerExists: true,
  dhcpNetworkExists: true,
  dhcpDnsServers: ["192.0.2.53"],
  hotspotServerName: "existing-hotspot",
  hotspotProfileName: "existing-profile",
  hotspotNatExists: true,
  radiusReady: false,
  allowlist: [
    { host: "203.0.113.10", source: "configured-vps", kind: "address" },
    { host: "tenant.example.org", source: "tenant-portal" },
  ],
};

test("includes the configured first VPS address and future additions", () => {
  const first = generateHotspotSetupScript(base);
  const later = generateHotspotSetupScript({
    ...base,
    allowlist: [...base.allowlist, { host: "203.0.113.11", source: "second-vps", kind: "address" }],
  });
  assert.match(first, /203\.0\.113\.10/);
  assert.doesNotMatch(first, /203\.0\.113\.11/);
  assert.match(later, /203\.0\.113\.11/);
});

test("reconciles only tagged allowlist entries and preserves PPPoE", () => {
  const script = generateHotspotSetupScript(base);
  assert.match(script, /comment~"\^BIL-HOTSPOTSETUP:41:allow:"/);
  assert.match(script, /remove \$entry/);
  assert.match(script, /PPPoE services, pools and customer sessions are preserved/);
  assert.doesNotMatch(script, /\/ppp\/(?:profile|secret|pool) (?:add|set|remove)/);
  assert.doesNotMatch(script, /\/interface\/bridge (?:add|remove)/);
});

test("rejects DHCP ranges overlapping the PPPoE pool or gateway", () => {
  assert.throws(
    () => generateHotspotSetupScript({
      ...base,
      gatewayCidr: "192.168.180.1/20",
      dhcpPoolRange: "192.168.185.10-192.168.185.30",
    }),
    /overlaps PPPoE pool/,
  );
  assert.throws(
    () => generateHotspotSetupScript({ ...base, dhcpPoolRange: "192.168.180.1-192.168.180.20" }),
    /overlaps the gateway/,
  );
});

test("uses configured domains only and never embeds credentials", () => {
  const script = generateHotspotSetupScript(base);
  assert.doesNotMatch(script, /ispledger|ocholanet\.com|paystack|flutterwave|opay/i);
  assert.doesNotMatch(script, /(?:password|secret|token)\s*=/i);
  assert.match(script, /dst-port=443/);
});

test("adds payment hosts only when that tenant gateway has saved configuration", () => {
  assert.deepEqual(configuredHotspotPaymentHosts("flutterwave", {}), []);
  const hosts = configuredHotspotPaymentHosts("flutterwave", { secretKey: "configured" });
  assert.deepEqual(hosts.map(item => item.host), ["api.flutterwave.com", "checkout.flutterwave.com"]);
  assert.deepEqual(configuredHotspotPaymentHosts("paystack", { secretKey: "anything" }), []);
});

test("enables only an already verified RADIUS assignment and embeds no secret", () => {
  const local = generateHotspotSetupScript(base);
  const verifiedRadius = generateHotspotSetupScript({ ...base, radiusReady: true });
  assert.doesNotMatch(local, /set \$verifiedProfile use-radius=yes/);
  assert.match(verifiedRadius, /set \$verifiedProfile use-radius=yes/);
  assert.match(verifiedRadius, /no shared secret is embedded or changed/);
  assert.doesNotMatch(verifiedRadius, /secret\s*=/i);
});

test("is repeatable and only adds managed DHCP, Hotspot, and NAT when missing", () => {
  const input = {
    ...base,
    dhcpServerExists: false,
    dhcpNetworkExists: false,
    hotspotServerName: undefined,
    hotspotProfileName: undefined,
    hotspotNatExists: false,
  };
  const script = generateHotspotSetupScript(input);
  assert.equal(script, generateHotspotSetupScript(input));
  assert.match(script, /comment="BIL-HOTSPOTSETUP:41:dhcp"/);
  assert.match(script, /comment="BIL-HOTSPOTSETUP:41:dhcp-network"/);
  assert.match(script, /comment="BIL-HOTSPOTSETUP:41:server"/);
  assert.match(script, /comment="BIL-HOTSPOTSETUP:41:nat"/);
  assert.match(script, /find where comment="BIL-HOTSPOTSETUP:41:allow:tenant-portal"/);
});

test("tenant admins stay in their own scope and Super Admin can select a tenant", () => {
  assert.equal(resolveHotspotSetupAdminId(12, "12"), 12);
  assert.equal(resolveHotspotSetupAdminId(12, "13"), 0);
  assert.equal(resolveHotspotSetupAdminId("superadmin", "13"), 13);
  assert.equal(resolveHotspotSetupAdminId("superadmin", ""), 0);
  assert.equal(resolveHotspotSetupAdminId("not-admin", "13"), 0);
});
