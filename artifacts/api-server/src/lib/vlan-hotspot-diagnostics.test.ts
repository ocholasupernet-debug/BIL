import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeVlanBridgePortIngress,
  summarizeVlanHotspotDiagnostics,
} from "./vlan-hotspot-diagnostics.js";

test("summarizes only the selected bridge-port ingress fields", () => {
  const result = summarizeVlanBridgePortIngress([
    {
      ".id": "*2",
      interface: "ether4",
      bridge: "hotspot-bridge",
      disabled: "false",
      running: "true",
      pvid: "20",
      "frame-types": "admit-only-vlan-tagged",
      "ingress-filtering": "true",
      "mac-address": "00:11:22:33:44:55",
      comment: "unrelated router metadata",
    },
  ], "ether4", "hotspot-bridge");

  assert.deepEqual(result, {
    interface: "ether4",
    bridge: "hotspot-bridge",
    disabled: "false",
    running: "true",
    pvid: "20",
    frameTypes: "admit-only-vlan-tagged",
    ingressFiltering: "true",
  });
  assert.equal(JSON.stringify(result).includes("mac-address"), false);
  assert.equal(
    summarizeVlanBridgePortIngress([], "ether4", "hotspot-bridge"),
    null,
  );
});

test("summarizes the VLAN server, assigned profile, portal files, and aggregate host counts", () => {
  const result = summarizeVlanHotspotDiagnostics({
    expectedServerName: "HS_RS29_VLAN20",
    expectedProfileName: "HS_PROFILE_RS29_VLAN20",
    expectedDirectory: "flash/hotspot/ochola_RS29_VLAN20",
    storedDnsName: "wewe.com",
    servers: [
      {
        name: "isp-hotspot",
        interface: "hotspot-bridge",
        profile: "default",
        "address-pool": "isp-pool",
        disabled: "no",
      },
      {
        name: "HS_RS29_VLAN20",
        interface: "VLAN20",
        profile: "HS_PROFILE_RS29_VLAN20",
        "address-pool": "HS_POOL_RS29_VLAN20",
        disabled: "no",
      },
    ],
    profiles: [
      { name: "default", "html-directory": "flash/hotspot", "dns-name": "isp.example" },
      {
        name: "HS_PROFILE_RS29_VLAN20",
        "html-directory": "flash/hotspot/ochola_RS29_VLAN20",
        "dns-name": "goo.isplatty.org",
        "hotspot-address": "192.168.184.1",
        "login-by": "http-chap,http-pap",
      },
    ],
    files: [
      { name: "flash/hotspot/login.html" },
      { name: "flash/hotspot/rlogin.html" },
      { name: "flash/hotspot/ochola_RS29_VLAN20/login.html" },
      { name: "flash/hotspot/ochola_RS29_VLAN20/rlogin.html" },
    ],
    hosts: [
      { server: "isp-hotspot", address: "192.168.184.22", "mac-address": "00:11:22:33:44:55" },
      { server: "HS_RS29_VLAN20", address: "192.168.184.23", "mac-address": "00:11:22:33:44:66" },
      { server: "HS_RS29_VLAN20", address: "192.168.184.24", "mac-address": "00:11:22:33:44:77" },
    ],
  });

  assert.equal(result.selectedServer?.interface, "VLAN20");
  assert.equal(result.selectedProfile?.dnsName, "goo.isplatty.org");
  assert.equal(result.expectedProfile?.htmlDirectory, "flash/hotspot/ochola_RS29_VLAN20");
  assert.deepEqual(result.missingExpectedPortalFiles, []);
  assert.deepEqual(result.hostCountsByServer, [
    { server: "HS_RS29_VLAN20", count: 2 },
    { server: "isp-hotspot", count: 1 },
  ]);
  assert.equal(JSON.stringify(result).includes("mac-address"), false);
});

test("reports a missing VLAN server and portal files instead of treating assignment state as proof", () => {
  const result = summarizeVlanHotspotDiagnostics({
    expectedServerName: "HS_RS29_VLAN20",
    expectedProfileName: "HS_PROFILE_RS29_VLAN20",
    expectedDirectory: "flash/hotspot/ochola_RS29_VLAN20",
    storedDnsName: null,
    servers: [{ name: "isp-hotspot", interface: "hotspot-bridge", profile: "default" }],
    profiles: [
      { name: "default", "html-directory": "flash/hotspot", "dns-name": "isp.example" },
      { name: "HS_PROFILE_RS29_VLAN20", "html-directory": "flash/hotspot/ochola_RS29_VLAN20" },
    ],
    files: [{ name: "flash/hotspot/login.html" }],
    hosts: [{ server: "isp-hotspot" }],
  });

  assert.equal(result.selectedServer, null);
  assert.equal(result.selectedProfile, null);
  assert.deepEqual(result.missingExpectedPortalFiles, [
    "flash/hotspot/ochola_RS29_VLAN20/login.html",
    "flash/hotspot/ochola_RS29_VLAN20/rlogin.html",
  ]);
  assert.deepEqual(result.hostCountsByServer, [{ server: "isp-hotspot", count: 1 }]);
});