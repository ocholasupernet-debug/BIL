import test from "node:test";
import assert from "node:assert/strict";
import { classifyRouterConnectionFailure } from "./mikrotik.js";

test("classifies an unreachable RouterOS API port as a TCP timeout", () => {
  const diagnosis = classifyRouterConnectionFailure(
    new Error("Port 8728 on 10.8.5.6 did not respond within 6s"),
  );

  assert.equal(diagnosis.profile, "tcp_timeout");
  assert.equal(diagnosis.summary, "TCP Timeout (Port 8728 blocked/unreachable)");
});

test("classifies RouterOS login rejection even when the host is a VPN address", () => {
  const diagnosis = classifyRouterConnectionFailure(
    new Error("RouterOS API login failed for 10.8.5.6 (VPN tunnel)"),
  );

  assert.equal(diagnosis.profile, "bad_credentials");
  assert.equal(diagnosis.summary, "Bad Credentials handshake");
});

test("classifies a failed management API forward as an offline VPN state", () => {
  const diagnosis = classifyRouterConnectionFailure(
    new Error("VPS management API forward failed: connection refused"),
  );

  assert.equal(diagnosis.profile, "offline_vpn_tunnel");
  assert.equal(diagnosis.summary, "Offline VPN tunnel container state");
});

test("classifies a duplicate hotspot user IP as a RouterOS user conflict", () => {
  const diagnosis = classifyRouterConnectionFailure(
    new Error("failure: already have user with this IP address"),
  );

  assert.equal(diagnosis.profile, "hotspot_user_conflict");
  assert.equal(diagnosis.summary, "Hotspot user/IP conflict");
});