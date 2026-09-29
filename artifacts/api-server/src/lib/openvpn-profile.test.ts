import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenVpnProviderProfile,
  hasActiveCustomerOvpnClient,
} from "./openvpn-profile.js";

const caCertificate = `-----BEGIN CERTIFICATE-----
MIIB
-----END CERTIFICATE-----`;

test("generates a RouterOS-importable UDP profile from provider settings", () => {
  const profile = buildOpenVpnProviderProfile({
    server: "vpn.example.net",
    port: "1194",
    protocol: "udp",
    caCertificate,
  });
  assert.equal(profile.server, "vpn.example.net");
  assert.equal(profile.port, 1194);
  assert.equal(profile.protocol, "udp");
  assert.match(profile.profileText, /^proto udp$/m);
  assert.match(profile.profileText, /^remote vpn\.example\.net 1194$/m);
  assert.match(profile.profileText, /<ca>\n-----BEGIN CERTIFICATE-----/);
  assert.match(profile.profileText, /auth-user-pass/);
  assert.doesNotMatch(profile.profileText, /password=/i);
});

test("generates TCP-client profiles with paired client certificates and keys", () => {
  const profile = buildOpenVpnProviderProfile({
    server: "192.0.2.14",
    port: 443,
    protocol: "tcp",
    caCertificate,
    clientCertificate: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
    clientKey: "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----",
  });
  assert.match(profile.profileText, /^proto tcp-client$/m);
  assert.match(profile.profileText, /<cert>/);
  assert.match(profile.profileText, /<key>/);
});

test("rejects invalid endpoints, incomplete certificates, and unpaired client keys", () => {
  const valid = {
    server: "vpn.example.net",
    port: 1194,
    protocol: "udp",
    caCertificate,
  };
  assert.throws(() => buildOpenVpnProviderProfile({ ...valid, server: "vpn.example.net; import evil" }), /hostname/i);
  assert.throws(() => buildOpenVpnProviderProfile({ ...valid, port: 70000 }), /port/i);
  assert.throws(() => buildOpenVpnProviderProfile({ ...valid, caCertificate: "not a PEM certificate" }), /PEM certificate/i);
  assert.throws(() => buildOpenVpnProviderProfile({
    ...valid,
    clientKey: "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----",
  }), /provided together/i);
});

test("counts only running non-management OVPN clients as active customer tunnels", () => {
  assert.equal(hasActiveCustomerOvpnClient([
    { name: "mainbillingvpn", comment: "", disabled: false, running: true },
    { name: "old-client", comment: "", disabled: true, running: true },
  ]), false);
  assert.equal(hasActiveCustomerOvpnClient([
    { name: "customer-vpn", comment: "provider uplink", disabled: false, running: true },
  ]), true);
});