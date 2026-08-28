import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

process.env.NODE_ENV = "production";

const outdir = "tests/.router-vpn-build";
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
await rm(outdir, { recursive: true, force: true });

const scriptsRoute = await readFile("src/routes/scripts-route.ts", "utf8");
const syncRoute = await readFile("src/routes/sync-route.ts", "utf8");

test("OpenVPN child fails loudly when the client is not created or running", () => {
  const script = mikrotik.generateRouterAsClientScript({
    vpsPublicIp: "vpn.example.test",
    vpnPort: 1196,
    vpnUsername: "router-42",
    vpnPassword: "one-time-token",
    tunnelRouterIp: "10.8.5.42",
    tunnelVpsIp: "10.8.5.1",
    routerId: 42,
  });
  assert.match(script, /\/interface ovpn-client add name=coreispbilling/);
  assert.match(script, /name="coreispbilling" and running=yes/);
  assert.match(script, /name="ocholasupernet"/);
  assert.doesNotMatch(script, /comment="ISP-42 VPS tunnel"/);
  assert.match(script, /OVPN client creation failed/);
  assert.match(script, /OVPN client did not establish a running session/);
  assert.match(script, /Check \/log for TLS, credential, certificate, or reachability errors/);
  assert.match(script, /ocholaVpnChildError/);
  assert.doesNotMatch(script, /on-error=\{ :set ovpnError \$error \}/);
  assert.doesNotMatch(script, /creation failed; check RouterOS/);
});

test("WireGuard child is isolated and contains no RouterOS 6 import path", () => {
  const script = mikrotik.generateRouterWireGuardClientScript({
    endpoint: "wg.example.test",
    endpointPort: 51820,
    serverPublicKey: "A".repeat(43),
    clientPrivateKey: "B".repeat(43),
    tunnelRouterIp: "10.8.5.42",
    tunnelVpsIp: "10.8.5.1",
    routerId: 42,
  });
  assert.match(script, /\/interface wireguard add/);
  assert.match(script, /management resources verified/);
  assert.match(scriptsRoute, /:if \(\$majorVersion = 7\) do=\{/);
  assert.match(scriptsRoute, /server-side WireGuard fallback is not configured/);
});

test("IPsec child verifies peer, identity, and policy resources without leaking secrets", () => {
  const script = mikrotik.generateRouterIpsecClientScript({
    endpoint: "ipsec.example.test",
    preSharedKey: 'a-secret-with-"quotes"',
    tunnelRouterIp: "10.8.5.42",
    tunnelVpsIp: "10.8.5.1",
    routerId: 42,
  });
  assert.match(script, /\/ip ipsec peer add/);
  assert.match(script, /\/ip ipsec identity add/);
  assert.match(script, /\/ip ipsec policy add/);
  assert.match(script, /IPsec policy was not verified/);
  assert.match(script, /a-secret-with-\\"quotes\\"/);
  assert.match(scriptsRoute, /server-side IPsec fallback is not configured/);
});

test("fallback order is OpenVPN then WireGuard then IPsec and stops after success", () => {
  const renderedBundle = scriptsRoute.slice(scriptsRoute.indexOf("return `# ${safeCompanyName} Main ISP Setup Script"));
  const openVpn = renderedBundle.indexOf('${vpnAttempt("openvpn"');
  const wireGuard = renderedBundle.indexOf("${wireGuardAttempt}");
  const ipsec = renderedBundle.indexOf("${ipsecAttempt}");
  assert.ok(openVpn >= 0 && wireGuard > openVpn && ipsec > wireGuard);
  assert.match(scriptsRoute, /:set vpnConfigured true/);
  assert.match(scriptsRoute, /:if \(!\$vpnConfigured\) do=\{/);
  assert.match(scriptsRoute, /failed-\$\{fileName\}/);
  assert.match(scriptsRoute, /:do \{ \/file set \[find name="\$\{fileName\}"\] name="failed-\$\{fileName\}" \}/);
  assert.match(scriptsRoute, /child script import failed/);
});

test("recoverable protocol failures do not poison a later successful install", () => {
  assert.match(syncRoute, /recoverableVpnAttempt = phase === "failed" && name\.startsWith\("vpn-"\)/);
  assert.match(syncRoute, /Only the final aggregate `vpn` failure/);
});