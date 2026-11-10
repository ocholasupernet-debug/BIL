import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdminFeatureKeyForPath,
  getAdminPageAuthFeatureKeyForPath,
  isAdminFeatureVisible,
  isPaymentGatewaySettingsPath,
} from "./admin-page-visibility.js";

test("Hotspot diagnostics uses its dedicated visibility and authorization key", () => {
  assert.equal(getAdminFeatureKeyForPath("/admin/network/hotspot-diagnostics"), "network.hotspot-diagnostics");
  assert.equal(isAdminFeatureVisible({}, "network.hotspot-diagnostics"), true);
  assert.equal(isAdminFeatureVisible({ "network.hotspot-diagnostics": false }, "network.hotspot-diagnostics"), false);
  assert.equal(getAdminPageAuthFeatureKeyForPath("/admin/network/hotspot-diagnostics"), "network.hotspot-diagnostics");
});

test("payment gateway settings are identified separately from other settings tabs", () => {
  assert.equal(isPaymentGatewaySettingsPath("/admin/settings?tab=gateways"), true);
  assert.equal(isPaymentGatewaySettingsPath("/admin/settings/?tab=gateways&source=nav"), true);
  assert.equal(isPaymentGatewaySettingsPath("/admin/settings?tab=profile"), false);
  assert.equal(isPaymentGatewaySettingsPath("/admin/settings/security?tab=gateways"), false);
  assert.equal(getAdminPageAuthFeatureKeyForPath("/admin/settings?tab=gateways"), null);
  assert.equal(getAdminPageAuthFeatureKeyForPath("/admin/settings?tab=profile"), "settings.profile");
});
