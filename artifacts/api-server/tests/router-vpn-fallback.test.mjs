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
const provisioningRoute = await readFile("src/lib/router-vpn-provisioning.ts", "utf8");
const syncRoute = await readFile("src/routes/sync-route.ts", "utf8");
const vpnStatus = await readFile("src/lib/vpn-status.ts", "utf8");
const vpnSettings = await readFile("../ochola-supernet/src/pages/vpn/Settings.tsx", "utf8");

test("management OpenVPN credentials use the configured router name", () => {
  assert.deepEqual(
    vpnContract.routerManagementOvpnCredentials("come2"),
    { username: "come2", password: "come2" },
  );
  assert.throws(
    () => vpnContract.routerManagementOvpnCredentials("come 2"),
    /Router name must be/,
  );
  assert.throws(
    () => vpnContract.routerManagementOvpnCredentials("../come2"),
    /Router name must be/,
  );
  assert.match(scriptsRoute, /routerManagementOvpnCredentials\(rows\[0\]\.name\)/);
  assert.doesNotMatch(scriptsRoute, /vpnUsername: `router-\$\{routerId\}`/);
  assert.match(syncRoute, /client\.cn === openVpnCredentials\.username/);
});

test("admin RouterOS operations forward management VPN connections through the VPS", () => {
  assert.match(syncRoute, /openVpsTcpForward, type VpsTcpForward/);
  assert.match(syncRoute, /forward = await openVpsTcpForward\(candidate, 8728/);
  assert.match(syncRoute, /conn = makeConn\(forward\.host, username, password\)/);
  assert.match(syncRoute, /closeForward: forward \? \(\) => forward!\.close\(\)/);

  const operationRoutes = [
    "/admin/sync",
    "/admin/sync/plans",
    "/admin/sync/ip-pools",
    "/admin/sync/users",
    "/admin/router/sync-copy",
    "/admin/router/reboot",
    "/admin/router/fix-api",
    "/admin/router/probe",
    "/admin/router/ports",
    "/admin/router/bridge-assign",
  ];
  for (const route of operationRoutes) {
    const start = syncRoute.indexOf(`router.post("${route}"`);
    assert.notEqual(start, -1, `${route} route should exist`);
    const end = syncRoute.indexOf("\n});", start);
    const source = syncRoute.slice(start, end === -1 ? undefined : end);
    assert.match(source, /connectWithFallback/, `${route} should use the forwarded connector`);
    assert.doesNotMatch(source, /makeConn\(/, `${route} must not connect directly`);
  }

  const adminRoutes = syncRoute.slice(syncRoute.indexOf('router.post("/admin/sync"'));
  assert.doesNotMatch(adminRoutes, /new RouterOSAPI/, "admin routes must not instantiate RouterOSAPI directly");
});

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
  assert.match(script, /\/interface ovpn-client add name="corebillingvpn"/);
  assert.match(script, /protocol=tcp mode=ip cipher=aes128 auth=sha1 add-default-route=no/);
  assert.match(script, /name="corebillingvpn" && running=yes/);
  assert.match(script, /remove \[find where name="coreispbilling"\]/);
  assert.match(script, /name="ocholasupernet"/);
  assert.doesNotMatch(script, /comment="ISP-42 VPS tunnel"/);
  assert.match(script, /OVPN client creation failed/);
  assert.match(script, /did not establish a running session within 60 seconds/);
  assert.match(script, /Safe interface diagnostics/);
  assert.match(script, /Recent RouterOS OpenVPN log entries/);
  assert.match(script, /ocholaVpnChildError/);
  assert.doesNotMatch(script, /on-error=\{ :set ovpnError \$error \}/);
  assert.doesNotMatch(script, /creation failed; check RouterOS/);
});

test("OpenVPN renders separate RouterOS 6 and 7 compatibility paths", () => {
  const options = {
    vpsPublicIp: "vpn.example.test",
    vpnPort: 1196,
    vpnUsername: "router-42",
    vpnPassword: "one-time-token",
    tunnelRouterIp: "10.8.5.42",
    tunnelVpsIp: "10.8.5.1",
    routerId: 42,
  };
  const ros6 = mikrotik.generateRouterAsClientScript({ ...options, routerOsMajor: 6 });
  const ros7 = mikrotik.generateRouterAsClientScript({ ...options, routerOsMajor: 7 });
  assert.match(ros6, /VERSION PATH: RouterOS 6/);
  assert.match(ros6, /protocol=tcp mode=ip cipher=aes128 auth=sha1/);
  assert.doesNotMatch(ros6, /cipher=aes128-cbc/);
  assert.doesNotMatch(ros6, /verify-server-certificate/);
  assert.match(ros7, /VERSION PATH: RouterOS 7\+/);
  assert.match(ros7, /protocol=tcp mode=ip cipher=aes128-cbc auth=sha1/);
  assert.match(ros7, /verify-server-certificate=no/);
  assert.match(scriptsRoute, /ros-version=/);
  assert.match(scriptsRoute, /routerOsMajor/);
});

test("installer reads RouterOS version locally and never defaults an unknown router to version 6", () => {
  assert.match(scriptsRoute, /\/system resource get version/);
  assert.doesNotMatch(scriptsRoute, /:global version \[\/system package update get installed-version\]/);
  assert.match(scriptsRoute, /:local routerOsMajorDigit \[:pick \$routerOsVersion 0 1\]/);
  assert.match(scriptsRoute, /\$routerOsMajorDigit = "7"/);
  assert.match(scriptsRoute, /\$routerOsMajorDigit = "6"/);
  assert.match(scriptsRoute, /Unsupported RouterOS version/);
  assert.match(scriptsRoute, /function requestedRouterOsMajor\(value: unknown\): 6 \| 7 \| null/);
  assert.match(scriptsRoute, /RouterOS major version is required/);
});

test("RouterOS 7 makes the RouterOS 6 path unreachable and skips WireGuard on RouterOS 6", () => {
  assert.match(scriptsRoute, /const openVpnSelection = routerVpnUrl/);
  assert.match(scriptsRoute, /:set openVpnUrl ""/);
  assert.match(scriptsRoute, /minimumMajor >= 7/);
  assert.match(scriptsRoute, /versionedUrlAssignment\("wireGuardUrl", safeRouterWireGuardUrl, 7\)/);
  assert.match(scriptsRoute, /:if \(\$majorVersion >= 7\) do=\{\\n\$\{vpnAttempt\("wireguard"/);
  assert.match(scriptsRoute, /ros-version=/);
  assert.match(scriptsRoute, /RouterOS 7 dry-run rejected the child script/);
  assert.match(scriptsRoute, /OCHOLA_ROUTER_VPN_ERROR/);
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
  assert.match(script, /interface ovpn-client add name="ochola-mgmt-vpn-42"/);
  assert.match(script, /comment="ochola-mgmt-vpn-42 VPS tunnel"/);
  assert.match(script, /previous incomplete management interface/);
  assert.match(script, /active or foreign ochola-mgmt-vpn-42 interface/);
  assert.match(script, /existingOvpnComment/);
  assert.match(script, /existingOvpnRunning/);
  assert.match(script, /interface ovpn-client find where name="ochola-mgmt-vpn-42"/);
  assert.doesNotMatch(script, /coreispbilling VPN interface exists/);
  assert.doesNotMatch(script, /ovpn-to-vps VPN interface exists/);
  assert.doesNotMatch(script, /ocholasupernet VPN interface exists/);
});

test("main coexistence diagnostics exclude unrelated billing OpenVPN clients and avoid duplicate errors", () => {
  assert.match(scriptsRoute, /const managementInterfaceName = installationMode === "coexist" && routerId/);
  assert.match(scriptsRoute, /interface ovpn-client find where name="\$\{expectedInterfaceName\}"/);
  assert.match(scriptsRoute, /\/log print where topics~"ovpn" && message~"\$\{expectedInterfaceName\}"/);
  assert.match(scriptsRoute, /\$vpnFailureSummary \. \$vpnError \. "; "/);
  assert.doesNotMatch(scriptsRoute, /\$vpnFailureSummary \. "\$\{protocol\}: " \. \$vpnError/);
  assert.match(scriptsRoute, /SCRIPT REVISION: coexistence-vpn-diagnostics-v3/);
  assert.match(scriptsRoute, /\.set\("Cache-Control", "no-store"\)\n    \.set\("Pragma", "no-cache"\)/);
});

test("main installer keeps routine terminal output quiet but preserves failures and completion", () => {
  assert.doesNotMatch(scriptsRoute, /:put "\[2\/7\] Downloading hotspot configuration/);
  assert.doesNotMatch(scriptsRoute, /:put "      Hotspot configuration applied; saved as hotspotsetup\.rsc\."/);
  assert.doesNotMatch(scriptsRoute, /all configurations completed successfully/);
  assert.match(scriptsRoute, /:put "\$\{safeCompanyName\}: setup complete\."/);
  assert.match(scriptsRoute, /:put \("  WARN \[vpn-\$\{protocol\}\] FAILED: " \. \$vpnError\)/);
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

test("coexistence fallback resources are router-specific", () => {
  const wireguard = mikrotik.generateRouterWireGuardClientScript({
    endpoint: "wg.example.test",
    serverPublicKey: "A".repeat(43),
    clientPrivateKey: "B".repeat(43),
    tunnelRouterIp: "10.8.5.42",
    tunnelVpsIp: "10.8.5.1",
    routerId: 42,
    installationMode: "coexist",
  });
  const ipsec = mikrotik.generateRouterIpsecClientScript({
    endpoint: "ipsec.example.test",
    preSharedKey: "router-secret",
    tunnelRouterIp: "10.8.5.42",
    tunnelVpsIp: "10.8.5.1",
    routerId: 42,
    installationMode: "coexist",
  });
  assert.match(wireguard, /ochola-mgmt-wg-42/);
  assert.match(ipsec, /ochola-mgmt-ipsec-42/);
  assert.doesNotMatch(wireguard, /corebillingvpn WireGuard management peer/);
  assert.doesNotMatch(ipsec, /corebillingvpn IPsec management peer/);
});

test("coexistence installer is OpenVPN-only", () => {
  assert.match(scriptsRoute, /const coexistenceFallbacksDisabled = installationMode === "coexist"/);
  assert.match(scriptsRoute, /const wireGuardAttempt = !coexistenceFallbacksDisabled/);
  assert.match(scriptsRoute, /const ipsecAttempt = !coexistenceFallbacksDisabled/);
  assert.match(scriptsRoute, /if \(installationMode === "takeover"\) \{/);
  assert.match(scriptsRoute, /WireGuard and IPsec fallbacks are disabled for coexistence installs/);
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
  assert.match(script, /address=ipsec\.example\.test exchange-mode=ike2/);
  assert.doesNotMatch(script, /address=ipsec\.example\.test\/32/);
  assert.match(script, /IPsec policy was not verified/);
  assert.match(script, /a-secret-with-\\"quotes\\"/);
  assert.match(scriptsRoute, /server-side prerequisites/);
});

test("fallback child generation preserves coexistence mode", () => {
  assert.match(provisioningRoute, /routerId,\s*installationMode,\s*\}\);/);
  assert.match(
    scriptsRoute,
    /generatedRouterVpnChildScript\("ipsec", routerId, material, routerOsMajor, installationMode\)/,
  );
});

test("IPsec renders explicit RouterOS 6 and 7 compatibility paths", () => {
  const options = {
    endpoint: "ipsec.example.test",
    preSharedKey: "router-secret",
    tunnelRouterIp: "10.8.5.42",
    tunnelVpsIp: "10.8.5.1",
    routerId: 42,
  };
  const ros6 = mikrotik.generateRouterIpsecClientScript({ ...options, routerOsMajor: 6 });
  const ros7 = mikrotik.generateRouterIpsecClientScript({ ...options, routerOsMajor: 7 });
  assert.match(ros6, /VERSION PATH: RouterOS 6/);
  assert.match(ros6, /exchange-mode=ike2/);
  assert.doesNotMatch(ros6, /send-initial-contact=yes/);
  assert.match(ros7, /VERSION PATH: RouterOS 7\+/);
  assert.match(ros7, /send-initial-contact=yes/);
  assert.match(ros6, /peer was not verified/);
  assert.match(ros7, /policy was not verified/);
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
  assert.doesNotMatch(scriptsRoute, /verifyFetchedFile\(`"\$\{tempFileName\}"`, tempFileName, true\)/);
  assert.match(scriptsRoute, /\/import "\$\{tempFileName\}" verbose=yes/);
  assert.match(scriptsRoute, /:local importError \$error/);
  assert.match(scriptsRoute, /:local rawVpnError \$error/);
  assert.match(scriptsRoute, /:set vpnError \("\$\{protocol\}: " \. \$attemptPhase \. " failed: " \. \$rawVpnError\)/);
  assert.match(scriptsRoute, /:local attemptPhase "start"/);
  assert.match(scriptsRoute, /larger \.rsc files are not reliably readable on/);
  assert.match(scriptsRoute, /const openVpnSelection = routerVpnUrl/);
  assert.match(scriptsRoute, /:set openVpnUrl ""/);
  assert.match(scriptsRoute, /Personalized router installer required/);
  assert.match(scriptsRoute, /child import/);
  assert.match(scriptsRoute, /OCHOLA_ROUTER_VPN_ERROR/);
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

test("router-management backup is isolated on TCP 1197 and maps router addresses", () => {
  assert.equal(vpnContract.ROUTER_MANAGEMENT_VPN_BACKUP.port, 1197);
  assert.equal(vpnContract.ROUTER_MANAGEMENT_VPN_BACKUP.network, "10.8.6.0/24");
  assert.equal(vpnContract.ROUTER_MANAGEMENT_VPN_BACKUP.interfaceName, "tun-router-backup");
  assert.equal(vpnContract.ROUTER_MANAGEMENT_VPN_BACKUP.authFilePath, "/etc/openvpn/router-backup-passwd");
  assert.equal(vpnContract.routerManagementBackupIp("10.8.5.42"), "10.8.6.42");
  assert.throws(() => vpnContract.routerManagementBackupIp("10.9.0.42"), /backup pool/);
});

test("VPS setup and runtime status readers use the same management paths", () => {
  const setup = vpnUtils.generateVpsOvpnSetupScript({ vpsPublicIp: "vpn.example.test" });
  assert.match(setup, /VPN Port  : 1196\/tcp/);
  assert.match(setup, /\/etc\/openvpn\/server\/ochola-router\.conf/);
  assert.match(setup, /\/etc\/openvpn\/router-passwd/);
  assert.match(setup, /\/etc\/openvpn\/server\/ochola-router-ccd/);
  assert.match(setup, /\/var\/log\/openvpn\/ochola-router-status\.log/);
  assert.match(setup, /\/etc\/openvpn\/router-ipp\.txt/);
   assert.match(setup, /topology net30/);
   assert.match(setup, /ifconfig-push 10\.8\.5\.2 10\.8\.5\.3/);
  assert.match(setup, /verify-client-cert none/);
  assert.match(setup, /client-cert-not-required/);
  assert.match(setup, /OPENVPN_SUPPORTS_VERIFY_CLIENT_CERT/);
  assert.match(setup, /OPENVPN_SUPPORTS_DATA_CIPHERS/);
  assert.match(setup, /\$\{value##\*\/\}.*none/);
  assert.match(setup, /\[ -n "\$DH_FILE" \] \|\| DH_FILE="none"/);
  assert.match(setup, /\[ -n "\$DH_FILE" \] && echo "dh \$DH_FILE"/);
  assert.doesNotMatch(setup, /openvpn --help.*verify-client-cert/);
  assert.match(setup, /grep -Fqx/);
  assert.match(setup, /\$\{!f\}/);
  assert.doesNotMatch(setup, /\$\{\$f\}/);
  assert.match(setup, /\$\{value##\*\/\}/);
  assert.match(setup, /# OpenVPN does not support data-ciphers/);
  assert.match(setup, /data-ciphers AES-128-CBC/);
  assert.match(setup, /ln -sfn "\$OVPN_CONF" "\$OVPN_DIR\/ochola-router\.conf"/);
  assert.match(setup, /Could not start the dedicated router-management OpenVPN service/);
  assert.match(setup, /TCP port 1196 is not listening/);
  assert.match(vpnSettings, /server 10\.8\.0\.0 255\.255\.255\.0[\s\S]{0,240}topology net30/);
  assert.match(vpnSettings, /auth-user-pass-verify[\s\S]{0,420}verify-client-cert none/);
  assert.match(vpnStatus, /ROUTER_MANAGEMENT_VPN\.statusPath/);
  assert.match(vpnStatus, /ROUTER_MANAGEMENT_VPN\.ippPath/);
  assert.match(scriptsRoute, /routerManagementVpnReadiness\(\)/);
  assert.match(scriptsRoute, /routerManagementVpnPortForRouter\(routerId\)/);
  assert.match(scriptsRoute, /if \(!readiness\.endpointConfigured\)/);
  assert.match(scriptsRoute, /The OpenVPN server may be hosted separately/);
  const backupSetup = vpnUtils.generateVpsOvpnSetupScript({
    vpsPublicIp: "vpn.example.test",
    vpnRole: "backup",
  });
  assert.match(backupSetup, /VPN Port  : 1197\/tcp/);
  assert.match(backupSetup, /server\/ochola-router-backup\.conf/);
  assert.match(backupSetup, /router-backup-passwd/);
  assert.match(backupSetup, /server\/ochola-router-backup-ccd/);
  assert.match(backupSetup, /ochola-router-backup-status\.log/);
  assert.match(backupSetup, /dev tun-router-backup/);
  assert.match(backupSetup, /ifconfig-push 10\.8\.6\.2 10\.8\.6\.3/);
  assert.doesNotMatch(backupSetup, /ochola-router\.conf"/);
  assert.match(scriptsRoute, /openvpn-backup/);
  assert.match(scriptsRoute, /routerManagementBackupIp\(tunnelRouterIp\)/);
});