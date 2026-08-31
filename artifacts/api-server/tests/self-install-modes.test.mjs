import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import path from "node:path";

process.env.NODE_ENV = "production";

const outdir = "tests/.self-install-modes-build";
await build({
  entryPoints: ["src/lib/mikrotik.ts"],
  outdir,
  bundle: true,
  platform: "node",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  external: ["node-routeros"],
  logLevel: "silent",
});
const mikrotik = await import(path.resolve(outdir, "mikrotik.cjs"));
const scriptsRoute = await readFile("src/routes/scripts-route.ts", "utf8");
const bridgeRoute = await readFile("src/routes/bridge-route.ts", "utf8");
const selfInstall = await readFile("../ochola-supernet/src/pages/admin/network/SelfInstall.tsx", "utf8");
/* esbuild's bundled pino logger starts a worker after module evaluation.
   Removing the output directory immediately can race that worker; clean up
   synchronously only when the test process is exiting. */
process.on("exit", () => rmSync(outdir, { recursive: true, force: true }));

test("coexistence OpenVPN removes only its exact stale client and preserves firewall resources", () => {
  const script = mikrotik.generateRouterAsClientScript({
    vpsPublicIp: "vpn.example.test",
    vpnPassword: "router-secret",
    tunnelRouterIp: "10.8.5.42",
    tunnelVpsIp: "10.8.5.1",
    installationMode: "coexist",
  });
  assert.match(script, /coexistence conflict/);
  assert.match(script, /interface ovpn-client add name="corebillingvpn"/);
  assert.match(script, /previous incomplete management interface/);
  assert.match(script, /existingOvpnComment/);
  assert.match(script, /existingOvpnRunning/);
  assert.match(script, /interface ovpn-client remove/);
  assert.doesNotMatch(script, /ip firewall filter remove/);
});

test("takeover retains a separate replacement path", () => {
  const script = mikrotik.generateRouterAsClientScript({
    vpsPublicIp: "vpn.example.test",
    vpnPassword: "router-secret",
    installationMode: "takeover",
  });
  assert.match(script, /interface ovpn-client remove/);
  assert.match(script, /ip firewall filter/);
});

test("WireGuard and IPsec coexistence paths do not delete prior resources", () => {
  const wireguard = mikrotik.generateRouterWireGuardClientScript({
    endpoint: "wg.example.test",
    serverPublicKey: "A".repeat(43),
    clientPrivateKey: "B".repeat(43),
    installationMode: "coexist",
  });
  const ipsec = mikrotik.generateRouterIpsecClientScript({
    endpoint: "ipsec.example.test",
    preSharedKey: "router-secret",
    installationMode: "coexist",
  });
  assert.match(wireguard, /coexistence conflict/);
  assert.doesNotMatch(wireguard, /\/remove/);
  assert.match(ipsec, /coexistence conflict/);
  assert.doesNotMatch(ipsec, /\/remove/);
});

test("takeover authorization is signed, scoped, and backup-first", () => {
  assert.match(scriptsRoute, /TAKEOVER_CONFIRMATION = "TAKE CONTROL"/);
  assert.match(scriptsRoute, /authenticatedAdminId\(req, req\.body\?\.adminId\)/);
  assert.match(scriptsRoute, /verifyTakeoverGrant\(takeoverGrant, Number\(rid\)\)/);
  const backup = scriptsRoute.indexOf("${takeoverBackup}");
  const serviceDownload = scriptsRoute.indexOf('/tool fetch url="${scriptsBase}/hotspotsetup.rsc"');
  assert.ok(backup >= 0 && serviceDownload > backup, "backup must be rendered before managed downloads");
  assert.match(scriptsRoute, /\/system backup save name=\$takeoverBackup/);
  assert.match(scriptsRoute, /\/export file=\$takeoverBackup/);
  assert.match(scriptsRoute, /Supabase customers, billing records, payments, and service history are never deleted/);
});

test("dashboard Self Install defaults to coexistence and requires typed takeover confirmation", () => {
  assert.match(selfInstall, /useState<InstallationMode>\("coexist"\)/);
  assert.match(selfInstall, /mode: "coexist"/);
  assert.match(selfInstall, /mode: "takeover"/);
  assert.match(selfInstall, /takeoverConfirmation !== "TAKE CONTROL"/);
  assert.match(selfInstall, /self-install\/takeover\/prepare/);
});

test("coexistence provisions an owned hotspot bridge without reusing shared service resources", () => {
  assert.match(scriptsRoute, /function coexistenceBridgeName\(routerId: number\)/);
  assert.match(scriptsRoute, /return `co-hotspot-bridge-\$\{routerId\}`/);
  assert.match(scriptsRoute, /legacyBridgeName "ochola-hs-\$\{routerId\}"/);
  assert.match(scriptsRoute, /interface bridge set \$legacyBridge name=\$bridgeName/);
  assert.match(scriptsRoute, /ochola-hs-pool-\$\{routerId\}/);
  assert.match(scriptsRoute, /ochola-hs-dhcp-\$\{routerId\}/);
  assert.match(scriptsRoute, /ochola-hs-server-\$\{routerId\}/);
  assert.match(scriptsRoute, /Existing billing bridges and ports are intentionally untouched/);
  assert.match(scriptsRoute, /Only this subnet is masqueraded; no global HTTP\/HTTPS redirects are added/);
  assert.match(scriptsRoute, /coexistence-hotspot\/\$\{encodeURIComponent\(rid\)\}/);
  assert.match(scriptsRoute, /verifyFetchedFile\('?"ochola-coexistence-hotspot\.rsc\.download"'/);
});

test("coexistence port changes reject foreign bridge ownership before assignBridgePorts", () => {
  const guard = bridgeRoute.indexOf("const conflicts = add");
  const assign = bridgeRoute.indexOf("const logs = await assignBridgePorts");
  assert.ok(guard >= 0 && assign > guard, "foreign-port guard must run before RouterOS assignment");
  assert.match(bridgeRoute, /Coexistence will not move ports already assigned to another billing bridge/);
  assert.match(bridgeRoute, /Coexistence can only use the isolated Ochola bridge/);
  assert.match(selfInstall, /Other billing · \$\{currentBridge\}/);
  assert.match(selfInstall, /installationMode,\s*addPorts/);
});