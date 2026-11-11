import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverConfiguredVpsRadius,
  parseRadiusProbeOutput,
} from "./radius-discovery.js";

test("RADIUS discovery requires SSH and a public VPS address", async () => {
  const discovery = await discoverConfiguredVpsRadius({
    host: "radius.internal",
    sshConfigured: true,
    resolveIp: async () => null,
    execute: async () => ({ ok: false, stdout: "", stderr: "" }),
    now: () => new Date("2026-11-11T10:00:00.000Z"),
  });
  assert.equal(discovery.detectedVpsIp, null);
  assert.equal(discovery.endpointVerified, false);
  assert.equal(discovery.radiusHost, null);
  assert.match(discovery.error ?? "", /offline or its secure check failed/);
});

test("RADIUS discovery does not publish an endpoint when FreeRADIUS is absent", async () => {
  const discovery = await discoverConfiguredVpsRadius({
    host: "1.1.1.1",
    sshConfigured: true,
    resolveIp: async host => host,
    execute: async () => ({
      ok: true,
      stdout: "installed=false\nrunning=false\nconfigurationValid=false\nauthenticationPort=\naccountingPort=\nauthenticationListening=false\naccountingListening=false\n",
      stderr: "",
    }),
  });
  assert.equal(discovery.installed, false);
  assert.equal(discovery.radiusHost, null);
  assert.equal(discovery.endpointVerified, false);
  assert.match(discovery.error ?? "", /not installed/);
});

test("RADIUS endpoint is verified only from valid, running listeners", async () => {
  const discovery = await discoverConfiguredVpsRadius({
    host: "1.1.1.1",
    sshConfigured: true,
    resolveIp: async host => host,
    execute: async () => ({
      ok: true,
      stdout: "installed=true\nrunning=true\nconfigurationValid=true\nauthenticationPort=18120\naccountingPort=18130\nauthenticationListening=true\naccountingListening=true\nmanagementVpnHost=10.8.5.1\nconfigRoot=/etc/freeradius/3.0\n",
      stderr: "",
    }),
    now: () => new Date("2026-11-11T10:01:00.000Z"),
  });
  assert.equal(discovery.endpointVerified, true);
  assert.equal(discovery.radiusHost, "10.8.5.1");
  assert.equal(discovery.detectedVpsIp, "1.1.1.1");
  assert.equal(discovery.authenticationPort, 18120);
  assert.equal(discovery.accountingPort, 18130);
});

test("RADIUS discovery requires the management VPN endpoint before publishing a router endpoint", async () => {
  const discovery = await discoverConfiguredVpsRadius({
    host: "1.1.1.1",
    sshConfigured: true,
    resolveIp: async host => host,
    execute: async () => ({
      ok: true,
      stdout: "installed=true\nrunning=true\nconfigurationValid=true\nauthenticationPort=1812\naccountingPort=1813\nauthenticationListening=true\naccountingListening=true\nconfigRoot=/etc/freeradius/3.0\n",
      stderr: "",
    }),
  });
  assert.equal(discovery.endpointVerified, false);
  assert.equal(discovery.radiusHost, null);
  assert.match(discovery.error ?? "", /management VPN endpoint/);
});

test("probe parser rejects unverified ports and ignores arbitrary output", () => {
  const probe = parseRadiusProbeOutput(
    "installed=true\nrunning=true\nconfigurationValid=true\nauthenticationPort=70000\naccountingPort=1813\nsecret=do-not-return\n",
  );
  assert.equal(probe.authenticationPort, null);
  assert.equal(probe.accountingPort, 1813);
  assert.equal(Object.hasOwn(probe, "secret"), false);
});
