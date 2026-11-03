import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdminPageAuthFeatureKeyForPath,
  isPaymentGatewaySettingsPath,
} from "./admin-page-visibility.js";

test("payment gateway settings are identified separately from other settings tabs", () => {
  assert.equal(isPaymentGatewaySettingsPath("/admin/settings?tab=gateways"), true);
  assert.equal(isPaymentGatewaySettingsPath("/admin/settings/?tab=gateways&source=nav"), true);
  assert.equal(isPaymentGatewaySettingsPath("/admin/settings?tab=profile"), false);
  assert.equal(isPaymentGatewaySettingsPath("/admin/settings/security?tab=gateways"), false);
  assert.equal(getAdminPageAuthFeatureKeyForPath("/admin/settings?tab=gateways"), null);
  assert.equal(getAdminPageAuthFeatureKeyForPath("/admin/settings?tab=profile"), "settings.profile");
});
