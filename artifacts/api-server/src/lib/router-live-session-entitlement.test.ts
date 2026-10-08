import assert from "node:assert/strict";
import test from "node:test";
import {
  customerEntitlesRouterSession,
  customerRecordHasActiveEntitlement,
  matchingActiveCustomerRecordsForRouterSession,
  voucherEntitlesLiveHotspotSession,
} from "./router-live-session-entitlement.js";

test("active customer accounts match only their supported live service identity", () => {
  const rows = [
    {
      type: "pppoe",
      status: "active",
      username: "shared-name",
      pppoe_username: "customer-ppp",
    },
  ];

  assert.equal(customerEntitlesRouterSession("pppoe", "customer-ppp", null, rows), true);
  assert.equal(customerEntitlesRouterSession("hotspot", "customer-ppp", null, rows), false);
});

test("matching active Hotspot accounts are returned for service-scope review", () => {
  const rows = [
    {
      id: 7,
      type: "hotspot",
      status: "active",
      username: "paid-user",
      router_id: 1,
      port_id: 10,
    },
    {
      id: 8,
      type: "hotspot",
      status: "suspended",
      username: "paid-user",
      router_id: 2,
      port_id: 20,
    },
  ];

  assert.deepEqual(
    matchingActiveCustomerRecordsForRouterSession("hotspot", "PAID-USER", null, rows)
      .map(customer => customer.id),
    [7],
  );
});

test("expired, suspended, and data-depleted accounts do not count as active", () => {
  const now = Date.parse("2026-10-08T12:00:00.000Z");
  assert.equal(customerRecordHasActiveEntitlement({ status: "active", expires_at: "2026-10-08T13:00:00Z" }, now), true);
  assert.equal(customerRecordHasActiveEntitlement({ status: "active", expires_at: "2026-10-08T11:00:00Z" }, now), false);
  assert.equal(customerRecordHasActiveEntitlement({ status: "suspended" }, now), false);
  assert.equal(customerRecordHasActiveEntitlement({ status: "active", depletion_reason: "data_limit" }, now), false);
});

test("a valid voucher protects its live session, while an expired voucher does not", () => {
  const now = Date.parse("2026-10-08T12:00:00.000Z");
  const base = {
    code: "V-123",
    validity_mins: 60,
    data_limit_mb: null,
    data_cap_mode: "disconnect" as const,
    redeemed_by_phone: null,
    service_expires_at: "2026-10-08T13:00:00.000Z",
    redeemed_at: "2026-10-08T11:00:00.000Z",
    expires_at: null,
  };
  assert.equal(voucherEntitlesLiveHotspotSession(base, [], now), true);
  assert.equal(
    voucherEntitlesLiveHotspotSession({ ...base, service_expires_at: "2026-10-08T11:00:00.000Z" }, [], now),
    false,
  );
  assert.equal(
    voucherEntitlesLiveHotspotSession({ ...base, redeemed_at: null, service_expires_at: null }, [], now),
    false,
  );
});
