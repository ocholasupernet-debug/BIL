import test from "node:test";
import assert from "node:assert/strict";
import { routerManagementVpnEndpoint } from "./router-management-vpn.js";

test("router VPN endpoint prefers its public hostname over the VPS SSH host", () => {
  assert.equal(
    routerManagementVpnEndpoint(undefined, "vpn.isplatty.com", "vpn.isplatty.org"),
    "vpn.isplatty.com",
  );
});

test("router VPN endpoint falls back to the VPS host when no VPN hostname is configured", () => {
  assert.equal(
    routerManagementVpnEndpoint(undefined, "", "vpn.isplatty.org"),
    "vpn.isplatty.org",
  );
});

test("explicit router endpoint overrides are normalized consistently", () => {
  assert.equal(
    routerManagementVpnEndpoint("https://vpn.isplatty.com:1196/setup", "vpn.isplatty.org", "vps.example"),
    "vpn.isplatty.com",
  );
});
