import assert from "node:assert/strict";
import test from "node:test";
import {
  isApprovedHotspotAssetDestination,
  isBulkReplacementScopeAllowed,
  parseBulkDeployMode,
} from "./bulk-hotspot-deployment.js";

test("bulk deployment mode defaults to install and rejects unknown values", () => {
  assert.equal(parseBulkDeployMode(undefined), "install");
  assert.equal(parseBulkDeployMode(" REPLACE "), "replace");
  assert.equal(parseBulkDeployMode("delete"), null);
});

test("replacement mode is limited to hotspot scope", () => {
  assert.equal(isBulkReplacementScopeAllowed("replace", "hotspot"), true);
  assert.equal(isBulkReplacementScopeAllowed("replace", "all"), false);
  assert.equal(isBulkReplacementScopeAllowed("install", "all"), true);
});

test("replacement destinations must stay inside flash/hotspot", () => {
  assert.equal(isApprovedHotspotAssetDestination("flash/hotspot/login.html"), true);
  assert.equal(isApprovedHotspotAssetDestination("flash\\hotspot\\assets\\portal.css"), true);
  assert.equal(isApprovedHotspotAssetDestination("flash/hotspot/../router.rsc"), false);
  assert.equal(isApprovedHotspotAssetDestination("flash/hotspotx/login.html"), false);
  assert.equal(isApprovedHotspotAssetDestination("flash/hotspot/"), false);
});