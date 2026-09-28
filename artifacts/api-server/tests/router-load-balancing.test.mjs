import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const bundlePath = "/tmp/isplatty-router-load-balancing-test.mjs";
execFileSync("pnpm", [
  "exec", "esbuild", "src/lib/router-load-balancing.ts",
  "--bundle", "--format=esm", "--platform=node", `--outfile=${bundlePath}`,
], { stdio: "ignore" });
const { buildLoadBalancingScript, validateLoadBalancingConfig, redactLoadBalancingScript } = await import(pathToFileURL(bundlePath).href);
const migration = await readFile(new URL("../migrations/2026_router_load_balancing.sql", import.meta.url), "utf8");
const protocolMigration = await readFile(new URL("../migrations/2026_router_multiwan_protocols.sql", import.meta.url), "utf8");
const migrationRunner = await readFile(new URL("../scripts/apply-deployment-migrations.mjs", import.meta.url), "utf8");

const config = {
  routerId: 7,
  adminId: 3,
  enabled: true,
  lanInterface: "bridge",
  routerOsVersion: "6",
  wans: [
    { name: "Primary", interfaceName: "ether1", gateway: "192.0.2.1", weight: 3, healthCheckIp: "1.1.1.1", enabled: true, position: 0 },
    { name: "Backup", interfaceName: "ether2", gateway: "198.51.100.1", weight: 1, healthCheckIp: "8.8.8.8", enabled: true, position: 1 },
  ],
};

test("validates unique WAN interfaces and health targets", () => {
  assert.deepEqual(validateLoadBalancingConfig(config, 7, 3).errors, []);
  const invalid = validateLoadBalancingConfig({
    ...config,
    wans: config.wans.map(wan => ({ ...wan, interfaceName: "ether1" })),
  }, 7, 3);
  assert.match(invalid.errors.join(" "), /duplicated/);
});

test("generates weighted RouterOS 6 PCC, routes, failover, and NAT", () => {
  const script = buildLoadBalancingScript(config).script;
  assert.match(script, /per-connection-classifier=both-addresses-and-ports:4\/0/);
  assert.match(script, /per-connection-classifier=both-addresses-and-ports:4\/3/);
  assert.match(script, /routing-mark="isplatty_lb_wan1"/);
  assert.doesNotMatch(script, /\srouting-table=/);
  assert.match(script, /ISPLATTY-LB-LOCAL/);
  assert.match(script, /out-interface="ether1" action=masquerade/);
  assert.match(script, /distance=21/);
});

test("generates RouterOS 7 routing tables without RouterOS 6 route syntax", () => {
  const script = buildLoadBalancingScript({ ...config, routerOsVersion: "7" }).script;
  assert.match(script, /\/routing table add name="isplatty_lb_wan1" fib=yes/);
  assert.match(script, /routing-table="isplatty_lb_wan1"/);
  assert.doesNotMatch(script, /\srouting-mark="isplatty_lb_wan1"/);
});

test("does not require incomplete disabled WAN drafts", () => {
  const result = validateLoadBalancingConfig({
    ...config,
    enabled: false,
    wans: [
      { ...config.wans[0], enabled: true },
      { name: "Future WAN", interfaceName: "", gateway: "", healthCheckIp: "", weight: 1, enabled: false, position: 1 },
    ],
  }, 7, 3);
  assert.deepEqual(result.errors, []);
});

test("removes only an explicitly selected WAN interface from its named bridge", () => {
  const script = buildLoadBalancingScript({
    ...config,
    wans: config.wans.map((wan, index) => index === 0
      ? { ...wan, reassignFromBridge: true, bridgeName: "bridge-lan" }
      : wan),
  }).script;
  assert.match(script, /\/interface bridge port remove \[find where bridge="bridge-lan" and interface="ether1"\]/);
  assert.doesNotMatch(script, /\/interface bridge port add/);
  assert.doesNotMatch(script, /bridge port remove \[find\]/);
  assert.ok(script.indexOf("/ip firewall nat add") < script.indexOf("/interface bridge port remove"));
});

test("pins LAN links and applies symmetric Mbps caps", () => {
  const script = buildLoadBalancingScript({
    ...config,
    lanLinks: [{ interfaceName: "ether5", wanPosition: 1, maxMbps: 25 }],
  }).script;
  assert.match(script, /in-interface="ether5".*new-connection-mark="ISPLATTY_LB_WAN2_CONN"/);
  assert.ok(script.split("\n").some(line =>
    line.includes('new-routing-mark="isplatty_lb_wan2"')
    && line.includes("route pinned LAN ether5"),
  ));
  assert.ok(script.indexOf('comment="ISPlatty-LB pin ether5"') < script.indexOf('comment="ISPlatty-LB PCC WAN 1"'));
  assert.match(script, /target="ether5" max-limit="25M\/25M"/);
});

test("accepts a stored PPPoE secret without exposing plaintext", () => {
  const pppoe = {
    ...config.wans[0],
    connectionType: "pppoe",
    gateway: "",
    pppoeUsername: "isp-user",
    pppoePassword: "",
    pppoeSecretConfigured: true,
  };
  const result = validateLoadBalancingConfig({ ...config, wans: [pppoe, config.wans[1]] }, 7, 3);
  assert.deepEqual(result.errors, []);
  const script = buildLoadBalancingScript({ ...config, wans: [pppoe, config.wans[1]] }).script;
  assert.doesNotMatch(script, /password=/);
  assert.match(script, /user="isp-user"/);
  assert.match(script, /dst-address="1\.1\.1\.1\/32" gateway="isplatty-pppoe1"/);
});

test("escapes RouterOS variable markers inside PPPoE credentials", () => {
  const pppoe = {
    ...config.wans[0],
    connectionType: "pppoe",
    gateway: "",
    pppoeUsername: "isp-user",
    pppoePassword: "pa$ss",
  };
  const script = buildLoadBalancingScript({ ...config, wans: [pppoe, config.wans[1]] }).script;
  assert.match(script, /password="pa\\\$ss"/);
  assert.doesNotMatch(redactLoadBalancingScript(script), /pa\\\$ss/);
});

test("allows a static uplink to rely on an existing address", () => {
  const result = validateLoadBalancingConfig({
    ...config,
    wans: config.wans.map(wan => ({ ...wan, staticAddressCidr: "" })),
  }, 7, 3);
  assert.deepEqual(result.errors, []);
});

test("builds DHCP and VLAN-tagged WAN interfaces with lease-bound health routes", () => {
  const script = buildLoadBalancingScript({
    ...config,
    wans: [
      { ...config.wans[0], connectionType: "dhcp", gateway: "", vlanId: 120 },
      config.wans[1],
    ],
  }).script;
  assert.match(script, /\/interface vlan add name="isplatty-vlan1" interface="ether1" vlan-id=120/);
  assert.match(script, /\/ip dhcp-client add interface="isplatty-vlan1"/);
  assert.match(script, /ISPlatty-LB DHCP WAN 1/);
  assert.match(script, /\/ip route disable \[find where comment="ISPlatty-LB health WAN 1"\]/);
});

test("routes a managed OpenVPN WAN through its selected non-OVPN underlay", () => {
  const script = buildLoadBalancingScript({
    ...config,
    routerOsVersion: "7",
    wans: [
      config.wans[0],
      {
        ...config.wans[1],
        connectionType: "ovpn",
        interfaceName: "isplatty-ovpn-wan2",
        gateway: "",
        underlayWanPosition: 0,
        ovpnRemoteAddresses: ["203.0.113.9"],
      },
    ],
  }, "7.15").script;
  assert.match(script, /dst-address="203\.0\.113\.9\/32" gateway="192\.0\.2\.1%ether1"/);
  assert.match(script, /dst-address="8\.8\.8\.8\/32" gateway="isplatty-ovpn-wan2"/);
  assert.match(script, /out-interface="isplatty-ovpn-wan2" action=masquerade/);
  assert.doesNotMatch(script, /\/interface ovpn-client remove/);
});

test("disabling managed OVPN removes only tagged WAN clients", () => {
  const script = buildLoadBalancingScript({
    ...config,
    enabled: false,
    wans: [
      config.wans[0],
      {
        ...config.wans[1],
        connectionType: "ovpn",
        interfaceName: "isplatty-ovpn-wan2",
        underlayWanPosition: 0,
      },
    ],
  }).script;
  assert.match(script, /\/interface ovpn-client remove \[find where comment~"\^ISPlatty-LB OVPN WAN "\]/);
  assert.doesNotMatch(script, /\/interface ovpn-client remove \[find\]/);
});

test("uses existing routed interfaces without claiming physical ports", () => {
  const result = validateLoadBalancingConfig({
    ...config,
    wans: [
      { ...config.wans[0], connectionType: "existing", interfaceName: "lte1", gateway: "" },
      config.wans[1],
    ],
  }, 7, 3);
  assert.deepEqual(result.errors, []);
  const script = buildLoadBalancingScript({
    ...config,
    wans: [
      { ...config.wans[0], connectionType: "existing", interfaceName: "lte1", gateway: "" },
      config.wans[1],
    ],
  }).script;
  assert.match(script, /dst-address="1\.1\.1\.1\/32" gateway="lte1"/);
  assert.doesNotMatch(script, /\/interface vlan add name="isplatty-vlan1"/);
});

test("disabling removes only managed uplinks and restores bridge state", () => {
  const script = buildLoadBalancingScript({
    ...config,
    enabled: false,
    wans: [{ ...config.wans[0], reassignFromBridge: true, bridgeName: "bridge-lan" }],
    lanLinks: [],
    allowBridgeFirewall: false,
    bridgeFirewallOriginal: false,
    restoreBridgePorts: [{ bridgeName: "bridge-lan", interfaceName: "ether1" }],
  }).script;
  assert.match(script, /\/interface pppoe-client remove \[find where comment~"\^ISPlatty-LB PPPoE "\]/);
  assert.match(script, /bridge port add bridge="bridge-lan" interface="ether1"/);
  assert.match(script, /\/interface bridge settings set use-ip-firewall=no/);
  assert.doesNotMatch(script, /\/interface bridge port remove/);
  assert.doesNotMatch(script, /\/ip firewall nat add/);
  assert.doesNotMatch(script, /\/ip address add/);
});

test("redacts PPPoE secrets from generated scripts", () => {
  const script = 'password="p@ssword" user="isp-user"';
  assert.equal(redactLoadBalancingScript(script), 'password="REDACTED" user="isp-user"');
});

test("deploys the schema that preserves the original bridge-firewall setting", () => {
  assert.match(migrationRunner, /2026_router_load_balancing\.sql/);
  assert.match(migration, /bridge_firewall_original\s+boolean/);
  assert.match(migration, /bridge_firewall_original\s*=\s*excluded\.bridge_firewall_original/);
  assert.match(migrationRunner, /2026_router_multiwan_protocols\.sql/);
  assert.match(protocolMigration, /connection_type in \('static', 'pppoe', 'dhcp', 'existing', 'ovpn'\)/);
  assert.match(protocolMigration, /isp_admin_openvpn_wan_profiles/);
});