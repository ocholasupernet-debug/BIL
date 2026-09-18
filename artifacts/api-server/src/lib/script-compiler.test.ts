import assert from "node:assert/strict";
import { test } from "node:test";
import { compileRouterScript, RouterScriptCompiler } from "./script-compiler.js";

const options = {
  radiusAddress: "10.8.5.1",
  radiusSecret: "test-radius-secret",
  dualServices: [{
    portName: "ether2",
    billingAddress: "10.8.5.1",
    billingPort: 8080,
  }],
  resellerQueues: [{
    portName: "ether2",
    limitMbps: 30,
    clients: [{ user: "alice", clientIp: "10.0.0.2", speedMbps: 10 }],
  }],
};

test("greenfield compiler renders a complete, validated script", () => {
  const script = compileRouterScript("greenfield", options);
  assert.match(script, /\/interface bridge add name="br-billing"/);
  assert.match(script, /\/ip address add address="192\.168\.88\.1\/24"/);
  assert.match(script, /\/radius add service=hotspot,ppp address="10\.8\.5\.1"/);
  assert.match(script, /\/radius incoming set accept=yes port=3799;/);
  assert.match(script, /html-directory="flash\/hotspot\/hs_ether2"/);
  assert.match(script, /max-mtu=1492 max-mru=1492/);
  assert.match(script, /action=dst-nat to-addresses="10\.8\.5\.1" to-ports=8080/);
  assert.match(script, /RESELLER_ROOT_ether2/);
  assert.match(script, /CLIENT_alice/);
  assert.ok(script.endsWith("\r\n"));
});

test("brownfield compiler preserves an existing bridge address", () => {
  const script = compileRouterScript("brownfield", options);
  assert.match(script, /Existing bridge\/address preserved; no replacement performed/);
  assert.match(script, /# Profile: brownfield/);
  assert.match(script, /:delay 2s;/);
});

test("compiler rejects unsafe values before rendering RouterOS", () => {
  assert.throws(
    () => new RouterScriptCompiler({ ...options, radiusAddress: "10.8.5.1; /system reboot" }),
    /RADIUS address must be an IPv4 address/,
  );
  assert.throws(
    () => compileRouterScript("greenfield", { ...options, radiusSecret: "" }),
    /RADIUS secret must be non-empty/,
  );
  assert.throws(
    () => compileRouterScript("greenfield", {
      ...options,
      resellerQueues: [{ portName: "ether2", limitMbps: 30, clients: [{ user: "bad user", clientIp: "10.0.0.2", speedMbps: 10 }] }],
    }),
    /Queue client must be/,
  );
});