import assert from "node:assert/strict";
import test from "node:test";
import {
  HOTSPOT_LOYALTY_DEVICE_AUTH_TTL_SECONDS,
  issueHotspotLoyaltyDeviceAuthorization,
  verifyHotspotLoyaltyDeviceAuthorization,
  type HotspotLoyaltyDeviceAuthorizationScope,
} from "./hotspot-loyalty-device-authorization.js";

const secret = "hotspot-loyalty-device-test-secret";
const scope: HotspotLoyaltyDeviceAuthorizationScope = {
  tenantAdminId: 33,
  customerAdminId: 33,
  customerId: 407,
  phone: "254700000001",
  macAddress: "AA:BB:CC:DD:EE:FF",
  routerId: 243,
  portId: null,
  resellerId: null,
};

test("signed device authorization is valid only for its customer and hotspot scope", () => {
  const now = Date.UTC(2026, 9, 8);
  const authorization = issueHotspotLoyaltyDeviceAuthorization(scope, secret, now);
  assert.ok(authorization);
  assert.equal(authorization.expiresAt, now + HOTSPOT_LOYALTY_DEVICE_AUTH_TTL_SECONDS * 1000);
  assert.equal(verifyHotspotLoyaltyDeviceAuthorization(authorization.token, scope, secret, now), true);
  assert.equal(verifyHotspotLoyaltyDeviceAuthorization(authorization.token, scope, "another-secret", now), false);
  assert.equal(verifyHotspotLoyaltyDeviceAuthorization(`${authorization.token}x`, scope, secret, now), false);
  assert.equal(verifyHotspotLoyaltyDeviceAuthorization(authorization.token, { ...scope, customerId: 408 }, secret, now), false);
  assert.equal(verifyHotspotLoyaltyDeviceAuthorization(authorization.token, { ...scope, phone: "254700000009" }, secret, now), false);
  assert.equal(verifyHotspotLoyaltyDeviceAuthorization(authorization.token, { ...scope, macAddress: "11:22:33:44:55:66" }, secret, now), false);
  assert.equal(verifyHotspotLoyaltyDeviceAuthorization(authorization.token, { ...scope, routerId: 244 }, secret, now), false);
  assert.equal(verifyHotspotLoyaltyDeviceAuthorization(authorization.token, { ...scope, portId: 49 }, secret, now), false);
});

test("signed device authorization expires and cannot be issued without a signing secret", () => {
  const now = Date.UTC(2026, 9, 8);
  const authorization = issueHotspotLoyaltyDeviceAuthorization(scope, secret, now);
  assert.ok(authorization);
  assert.equal(
    verifyHotspotLoyaltyDeviceAuthorization(
      authorization.token,
      scope,
      secret,
      authorization.expiresAt + 1,
    ),
    false,
  );
  assert.equal(issueHotspotLoyaltyDeviceAuthorization(scope, undefined, now), null);
  assert.equal(verifyHotspotLoyaltyDeviceAuthorization(authorization.token, scope, undefined, now), false);
});
