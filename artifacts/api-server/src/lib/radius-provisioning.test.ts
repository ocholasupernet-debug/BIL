import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManagedRadiusClientFile,
  buildRadiusClientFileProvisionScript,
  normalizeRadiusClientIp,
} from "./radius-provisioning.js";

test("only assigned management VPN addresses can be enrolled as RADIUS clients", () => {
  assert.equal(normalizeRadiusClientIp("10.8.5.16"), "10.8.5.16");
  assert.throws(() => normalizeRadiusClientIp("10.8.5.1"), /management VPN/);
  assert.throws(() => normalizeRadiusClientIp("10.8.5.255"), /management VPN/);
  assert.throws(() => normalizeRadiusClientIp("8.8.8.8"), /management VPN/);
  assert.throws(() => normalizeRadiusClientIp("router.example.net"), /management VPN/);
});

test("FreeRADIUS client definitions are tagged and scoped to one router", () => {
  const content = buildManagedRadiusClientFile({
    routerId: 73,
    vpnIp: "10.8.5.73",
  }, "strong-safe-secret");
  assert.match(content, /Managed by OcholaSupernet for router 73/);
  assert.match(content, /client ochola_router_73/);
  assert.match(content, /ipaddr = 10\.8\.5\.73/);
  assert.match(content, /secret = "strong-safe-secret"/);
});

test("remote provisioning sends the secret only as stdin content and protects unmanaged files", () => {
  const secret = "strong-safe-secret";
  const content = buildManagedRadiusClientFile({ routerId: 73, vpnIp: "10.8.5.73" }, secret);
  const script = buildRadiusClientFileProvisionScript({
    routerId: 73,
    content,
    replaceManaged: false,
    configRoot: "/etc/freeradius/3.0",
  });
  assert.equal(script.includes(secret), false);
  assert.match(script, /managed_file_conflict/);
  assert.match(script, /Managed by OcholaSupernet for router 73/);
  assert.match(script, /radius_bin.*-XC/);
  assert.match(script, /systemctl reload 'freeradius'/);
  assert.match(script, /\$INCLUDE clients\.d\/ochola-router-73\.conf/);
  assert.match(script, /grep -Fqx "\$include_line" "\$conf"/);
  assert.match(script, /configuration_rejected/);
});
