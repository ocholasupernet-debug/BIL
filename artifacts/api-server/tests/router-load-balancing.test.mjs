import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const bundlePath = "/tmp/isplatty-router-load-balancing-test.mjs";
execFileSync("pnpm", [
  "exec", "esbuild", "src/lib/router-load-balancing.ts",
  "--bundle", "--format=esm", "--platform=node", `--outfile=${bundlePath}`,
], { stdio: "ignore" });
const { buildLoadBalancingScript, validateLoadBalancingConfig } = await import(pathToFileURL(bundlePath).href);

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
  assert.match(script, /routing-mark="isp_lb_wan1"/);
  assert.doesNotMatch(script, /\srouting-table=/);
  assert.match(script, /ISPLATTY-LB-LOCAL/);
  assert.match(script, /out-interface="ether1" action=masquerade/);
  assert.match(script, /distance=21/);
});

test("generates RouterOS 7 routing tables without RouterOS 6 route syntax", () => {
  const script = buildLoadBalancingScript({ ...config, routerOsVersion: "7" }).script;
  assert.match(script, /\/routing table add name="isp_lb_wan1" fib=yes/);
  assert.match(script, /routing-table="isp_lb_wan1"/);
  assert.doesNotMatch(script, /\srouting-mark="isp_lb_wan1"/);
});