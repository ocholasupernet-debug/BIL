import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/routes/mikrotik-route.ts", "utf8");
const start = source.indexOf('router.get("/router/:id/self-install-script"');
const end = source.indexOf("\n});", start);
const selfInstallRoute = source.slice(start, end);

test("Self Install uses the VPS provisioner's server-configured VPN endpoint", () => {
  assert.notEqual(start, -1, "Self Install route should exist");
  assert.match(selfInstallRoute, /const vpsIp = vpnEndpointHost\(process\.env\.ROUTER_OPENVPN_ENDPOINT \|\| process\.env\.VPS_HOST\);/);
  assert.doesNotMatch(selfInstallRoute, /vpnEndpointHost\(req\.query\.vpsIp \|\| process\.env\.VPS_HOST\)/);
});

test("Self Install reports an actionable endpoint mismatch instead of a generic linkage error", () => {
  assert.match(selfInstallRoute, /The VPS management VPN endpoint does not match the configured endpoint\./);
  assert.match(selfInstallRoute, /ROUTER_OPENVPN_ENDPOINT is the public hostname configured on the VPS/);
  assert.doesNotMatch(selfInstallRoute, /VPS router-management OpenVPN linkage is incomplete/);
});
