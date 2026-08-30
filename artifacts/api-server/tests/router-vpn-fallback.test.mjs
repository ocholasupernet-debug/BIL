import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

process.env.NODE_ENV = "production";

const outdir = "tests/.router-vpn-build";
await build({
  entryPoints: [
    "src/lib/mikrotik.ts",
    "src/lib/router-management-vpn.ts",
    "src/lib/vpn-utils.ts",
  ],
  outdir,
  bundle: true,
  platform: "node",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  external: ["node-routeros"],
  logLevel: "silent",
});
const mikrotik = await import(path.resolve(outdir, "mikrotik.cjs"));
const vpnContract = await import(path.resolve(outdir, "router-management-vpn.cjs"));
const vpnUtils = await import(path.resolve(outdir, "vpn-utils.cjs"));
await rm(outdir, { recursive: true, force: true });

const scriptsRoute = await readFile("src/routes/scripts-route.ts", "utf8");
const syncRoute = await readFile("src/routes/sync-route.ts", "utf8");
const vpnStatus = await readFile("src/lib/vpn-status.ts", "utf8");

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
  assert.match(script, /\/interface ovpn-client add name=corebillingvpn/);
  assert.match(script, /mode=ip cipher=aes128 auth=sha1 add-default-route=no/);
  assert.match(script, /name="corebillingvpn" && running=yes/);
  assert.match(script, /remove \[find where name="coreispbilling"\]/);
  assert.match(script, /name="ocholasupernet"/);
  assert.doesNotMatch(script, /comment="ISP-42 VPS tunnel"/);
  assert.match(script, /OVPN client creation failed/);
  assert.match(script, /OVPN client did not establish a running session/);
  assert.match(script, /Check \/log for TLS, credential, certificate, or reachability errors/);
  assert.match(script, /ocholaVpnChildError/);
  assert.doesNotMatch(script, /on-error=\{ :set ovpnError \$error \}/);
  assert.doesNotMatch(script, /creation failed; check RouterOS/);
});

test("Coexistence OpenVPN uses a router-specific interface without blocking legacy VPNs", () => {
  const script = mikrotik.generateRouterAsClientScript({
    vpsPublicIp: "vpn.example.test",
    vpnPort: 1196,
    vpnUsername: "router-42",
    vpnPassword: "one-time-token",
    tunnelRouterIp: "10.8.5.42",
    tunnelVpsIp: "10.8.5.1",
    routerId: 42,
    installationMode: "coexist",
  });
  assert.match(script, /interface ovpn-client add name=ochola-mgmt-vpn-42/);
  assert.match(script, /comment="ochola-mgmt-vpn-42 VPS tunnel"/);
  assert.doesNotMatch(script, /coreispbilling VPN interface exists/);
  assert.doesNotMatch(script, /ovpn-to-vps VPN interface exists/);
  assert.doesNotMatch(script, /ocholasupernet VPN interface exists/);
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
  assert.match(scriptsRoute, /:if \(\$majorVersion >= 7\) do=\{/);
  assert.doesNotMatch(scriptsRoute, /WIREGUARD skipped: RouterOS 7 or newer is required/);
  assert.doesNotMatch(scriptsRoute, /WIREGUARD skipped: server-side WireGuard fallback is not configured/);
  assert.doesNotMatch(scriptsRoute, /IPSEC skipped: server-side IPsec fallback is not configured/);
  assert.match(scriptsRoute, /routerWireGuardUrl = fallbackUrl\("wireguard"\)/);
  assert.match(scriptsRoute, /routerIpsecUrl = fallbackUrl\("ipsec"\)/);
  assert.match(scriptsRoute, /server-side prerequisites/);
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
  assert.match(scriptsRoute, /server-side prerequisites/);
});

test("fallback order is OpenVPN then WireGuard then IPsec and stops after success", () => {
  const renderedBundle = scriptsRoute.slice(scriptsRoute.indexOf("return `# ${safeCompanyName} Main ISP Setup Script"));
  const openVpn = renderedBundle.indexOf('${vpnAttempt("openvpn"');
  const wireGuard = renderedBundle.indexOf("${wireGuardAttempt}");
  const ipsec = renderedBundle.indexOf("${ipsecAttempt}");
  assert.ok(openVpn >= 0 && wireGuard > openVpn && ipsec > wireGuard);
  assert.match(scriptsRoute, /:set vpnConfigured true/);
  assert.match(scriptsRoute, /:if \(!\$vpnConfigured\) do=\{/);
  assert.match(scriptsRoute, /const tempFileName = `\$\{fileName\}\.download`/);
  assert.match(scriptsRoute, /failed-\$\{fileName\}/);
  assert.match(scriptsRoute, /:do \{ \/file set \[find name="\$\{tempFileName\}"\] name="failed-\$\{fileName\}" \}/);
  assert.match(scriptsRoute, /child script import failed/);
});

test("recoverable protocol failures do not poison a later successful install", () => {
  assert.match(syncRoute, /recoverableVpnAttempt = phase === "failed" && name\.startsWith\("vpn-"\)/);
  assert.match(syncRoute, /Only the final aggregate `vpn` failure/);
});

test("router-management VPN contract is consistent and defaults to TCP 1196", () => {
  assert.equal(vpnContract.ROUTER_MANAGEMENT_VPN.port, 1196);
  assert.equal(vpnContract.ROUTER_MANAGEMENT_VPN.network, "10.8.5.0/24");
  assert.equal(vpnContract.ROUTER_MANAGEMENT_VPN.authFilePath, "/etc/openvpn/router-passwd");
  assert.equal(vpnContract.ROUTER_MANAGEMENT_VPN.ccdPath, "/etc/openvpn/server/ochola-router-ccd");
  assert.equal(vpnContract.ROUTER_MANAGEMENT_VPN.statusPath, "/var/log/openvpn/ochola-router-status.log");
  assert.equal(vpnContract.ROUTER_MANAGEMENT_VPN.ippPath, "/etc/openvpn/router-ipp.txt");
  delete process.env.ROUTER_OPENVPN_PORT;
  assert.equal(vpnContract.routerManagementVpnPort(), 1196);
  process.env.ROUTER_OPENVPN_PORT = "1196";
  assert.equal(vpnContract.routerManagementVpnPort(), 1196);
  process.env.ROUTER_OPENVPN_PORT = "not-a-port";
  assert.throws(() => vpnContract.routerManagementVpnPort(), /ROUTER_OPENVPN_PORT/);
  delete process.env.ROUTER_OPENVPN_PORT;
});

test("VPS setup and runtime status readers use the same management paths", () => {
  const setup = vpnUtils.generateVpsOvpnSetupScript({ vpsPublicIp: "vpn.example.test" });
  assert.match(setup, /VPN Port  : 1196\/tcp/);
  assert.match(setup, /\/etc\/openvpn\/server\/ochola-router\.conf/);
  assert.match(setup, /\/etc\/openvpn\/router-passwd/);
  assert.match(setup, /\/etc\/openvpn\/server\/ochola-router-ccd/);
  assert.match(setup, /\/var\/log\/openvpn\/ochola-router-status\.log/);
  assert.match(setup, /\/etc\/openvpn\/router-ipp\.txt/);
  assert.match(vpnStatus, /ROUTER_MANAGEMENT_VPN\.statusPath/);
  assert.match(vpnStatus, /ROUTER_MANAGEMENT_VPN\.ippPath/);
  assert.match(scriptsRoute, /routerManagementVpnReadiness\(\)/);
  assert.match(scriptsRoute, /routerManagementVpnPort\(\)/);
  assert.match(scriptsRoute, /if \(!readiness\.endpointConfigured\)/);
  assert.match(scriptsRoute, /The OpenVPN server may be hosted separately/);
});