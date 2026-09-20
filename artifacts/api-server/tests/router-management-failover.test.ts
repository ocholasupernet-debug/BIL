import test from "node:test";
import assert from "node:assert/strict";
import { generateRouterManagementVpnScript } from "../src/lib/mikrotik.js";

const baseOptions = {
  vpsPublicIp: "vpn.example.test",
  vpnPort: 1196,
  vpnUsername: "router-42",
  vpnPassword: "one-time-token",
  caCertificateUrl: "https://vpn.example.test/api/vpn/ca.crt",
  backendRegistrationUrl: "https://vpn.example.test/api/isp/router/register/test-token",
  tunnelRouterIp: "10.8.5.42",
  tunnelVpsIp: "10.8.5.1",
  routerId: 42,
} as const;

test("Self Install configures the primary before the disabled backup", () => {
  const script = generateRouterManagementVpnScript({
    ...baseOptions,
    backupVpnPort: 1197,
    backupVpnUsername: "router-42",
    backupVpnPassword: "one-time-token",
    backupTunnelRouterIp: "10.8.6.42",
    backupTunnelVpsIp: "10.8.6.1",
  });

  const primaryAdd = script.indexOf('name="ocholasupernet" connect-to="vpn.example.test" port=1196');
  const backupAdd = script.indexOf('name="ocholasupernet-backup" connect-to="vpn.example.test" port=1197');
  const scheduler = script.indexOf('add name="ochola-mgmt-failover-42"');
  const primaryEnable = script.indexOf('find where name="ocholasupernet"] disabled=no');
  const backupEnable = script.indexOf('find where name="ocholasupernet-backup"] disabled=no');

  assert.ok(primaryAdd >= 0);
  assert.ok(backupAdd > primaryAdd);
  assert.ok(scheduler > backupAdd);
  assert.ok(primaryEnable < backupEnable);
  assert.match(script, /interface ovpn-client add name="ocholasupernet-backup"[^\n]*disabled=yes/);
  assert.match(script, /if \(!\$primaryRunning\)[\s\S]*set \$backupId disabled=no/);
  assert.match(script, /primary management VPN restored; backup management VPN disabled/);
  assert.match(script, /10\.8\.6\.0\/24/);
  assert.match(script, /Primary tunnel is down; using the backup management tunnel/);
});

test("A primary-only generated client does not install a failover scheduler", () => {
  const script = generateRouterManagementVpnScript(baseOptions);
  assert.doesNotMatch(script, /interface ovpn-client add name="ocholasupernet-backup"/);
  assert.doesNotMatch(script, /ochola-mgmt-failover/);
});