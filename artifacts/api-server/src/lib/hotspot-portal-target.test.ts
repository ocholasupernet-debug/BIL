import assert from "node:assert/strict";
import test from "node:test";
import {
  listActiveHotspotProfileTargets,
  selectUniqueActiveHotspotServer,
  selectUniquePrimaryHotspotProfile,
  summarizeHotspotPortalPreflight,
} from "./hotspot-portal-target.js";

test("automatically selects the only active Hotspot server", () => {
  const selection = selectUniqueActiveHotspotServer([
    { name: "disabled", interface: "bridge-old", profile: "old", disabled: "yes" },
    { name: "main", interface: "come3-lan", profile: "default", disabled: "no" },
  ]);

  assert.equal(selection.selected?.name, "main");
  assert.deepEqual(selection.activeServers.map(server => server.interface), ["come3-lan"]);
});

test("an explicit interface matches exactly even when another active service exists", () => {
  const selection = selectUniqueActiveHotspotServer([
    { name: "main", interface: "come3-lan", profile: "default" },
    { name: "guest", interface: "guest-vlan", profile: "guest" },
  ], "guest-vlan");

  assert.equal(selection.selected?.name, "guest");
  assert.equal(selection.candidates.length, 1);
});

test("automatic selection fails closed when there are multiple active Hotspot servers", () => {
  const selection = selectUniqueActiveHotspotServer([
    { name: "main", interface: "come3-lan", profile: "default" },
    { name: "guest", interface: "guest-vlan", profile: "guest" },
  ]);

  assert.equal(selection.selected, null);
  assert.equal(selection.activeServers.length, 2);
});

test("an explicit interface with no matching active server remains unselected", () => {
  const selection = selectUniqueActiveHotspotServer([
    { name: "main", interface: "come3-lan", profile: "default" },
  ], "co-hotspot-bridge");

  assert.equal(selection.selected, null);
  assert.equal(selection.candidates.length, 0);
});

test("primary portal selection finds one root profile and ignores isolated service folders", () => {
  const selection = selectUniquePrimaryHotspotProfile(
    [
      { name: "main", interface: "bridge-main", profile: "main-profile" },
      { name: "port-2", interface: "bridge-port-2", profile: "port-profile" },
    ],
    [
      { ".id": "*1", name: "main-profile", "html-directory": "flash/hotspot" },
      { ".id": "*2", name: "port-profile", "html-directory": "flash/hotspot/hs_ether2" },
    ],
  );

  assert.deepEqual(selection.selected, {
    serverName: "main",
    interfaceName: "bridge-main",
    profileName: "main-profile",
    profileId: "*1",
    htmlDirectory: "flash/hotspot",
  });
  assert.equal(selection.candidates.length, 1);
});

test("primary portal selection fails closed for multiple active root profiles", () => {
  const selection = selectUniquePrimaryHotspotProfile(
    [
      { name: "main", interface: "bridge-main", profile: "main-profile" },
      { name: "reseller", interface: "bridge-reseller", profile: "reseller-profile" },
    ],
    [
      { ".id": "*1", name: "main-profile", "html-directory": "hotspot" },
      { ".id": "*2", name: "reseller-profile", "html-directory": "disk1/hotspot" },
    ],
  );

  assert.equal(selection.candidates.length, 2);
  assert.equal(selection.selected, null);
});

test("primary portal selection ignores disabled servers and nested service directories", () => {
  const selection = selectUniquePrimaryHotspotProfile(
    [
      { name: "disabled", interface: "bridge-disabled", profile: "root-profile", disabled: "yes" },
      { name: "service", interface: "bridge-service", profile: "service-profile" },
    ],
    [
      { ".id": "*1", name: "root-profile", "html-directory": "hotspot" },
      { ".id": "*2", name: "service-profile", "html-directory": "flash/hotspot/hs_port_2" },
    ],
  );

  assert.equal(selection.candidates.length, 0);
  assert.equal(selection.selected, null);
});

test("primary portal selection rejects a root profile shared by multiple active servers", () => {
  const selection = selectUniquePrimaryHotspotProfile(
    [
      { name: "hs-1", interface: "bridge-1", profile: "shared-profile" },
      { name: "hs-2", interface: "bridge-2", profile: "shared-profile" },
    ],
    [{ ".id": "*1", name: "shared-profile", "html-directory": "hotspot" }],
  );

  assert.equal(selection.candidates.length, 2);
  assert.equal(selection.selected, null);
});

test("read-only portal inventory includes nested flash services and unresolved active profiles", () => {
  const targets = listActiveHotspotProfileTargets(
    [
      { name: "main", interface: "bridge-main", profile: "main-profile" },
      { name: "port-2", interface: "bridge-port-2", profile: "port-profile" },
      { name: "missing", interface: "bridge-missing", profile: "deleted-profile" },
      { name: "disabled", interface: "bridge-disabled", profile: "main-profile", disabled: "yes" },
    ],
    [
      { ".id": "*1", name: "main-profile", "html-directory": "/flash\\hotspot/" },
      { ".id": "*2", name: "port-profile", "html-directory": "flash/hotspot/hs_ether2" },
    ],
  );

  assert.deepEqual(targets, [
    {
      serverName: "main",
      interfaceName: "bridge-main",
      profileName: "main-profile",
      profileId: "*1",
      htmlDirectory: "flash/hotspot",
    },
    {
      serverName: "port-2",
      interfaceName: "bridge-port-2",
      profileName: "port-profile",
      profileId: "*2",
      htmlDirectory: "flash/hotspot/hs_ether2",
    },
    {
      serverName: "missing",
      interfaceName: "bridge-missing",
      profileName: "deleted-profile",
      profileId: null,
      htmlDirectory: null,
    },
  ]);
});

test("portal preflight identifies one legacy flash root and preserves nested service folders", () => {
  const summary = summarizeHotspotPortalPreflight(
    [
      { name: "main", interface: "bridge-main", profile: "main-profile" },
      { name: "port-2", interface: "bridge-port-2", profile: "port-profile" },
    ],
    [
      { ".id": "*1", name: "main-profile", "html-directory": "flash/hotspot" },
      { ".id": "*2", name: "port-profile", "html-directory": "flash/hotspot/hs_ether2" },
    ],
    ["/flash\\hotspot\\login.html", "flash/hotspot/rlogin.html", "hotspot/login.html"],
  );

  assert.equal(summary.status, "uses_flash_root");
  assert.equal(summary.primaryProfileCount, 1);
  assert.deepEqual(summary.rootPortalFiles, { login: true, redirectLogin: false });
  assert.deepEqual(summary.services.map(service => ({
    htmlDirectory: service.htmlDirectory,
    login: service.login,
    redirectLogin: service.redirectLogin,
    isolated: service.isolatedServiceDirectory,
  })), [
    { htmlDirectory: "flash/hotspot", login: true, redirectLogin: true, isolated: false },
    { htmlDirectory: "flash/hotspot/hs_ether2", login: false, redirectLogin: false, isolated: true },
  ]);
});

test("portal preflight reports ambiguous roots without selecting one", () => {
  const summary = summarizeHotspotPortalPreflight(
    [
      { name: "main", interface: "bridge-main", profile: "main-profile" },
      { name: "other", interface: "bridge-other", profile: "other-profile" },
    ],
    [
      { ".id": "*1", name: "main-profile", "html-directory": "flash/hotspot" },
      { ".id": "*2", name: "other-profile", "html-directory": "hotspot" },
    ],
    [],
  );

  assert.equal(summary.status, "ambiguous_root_profiles");
  assert.equal(summary.primaryProfileCount, 2);
});
