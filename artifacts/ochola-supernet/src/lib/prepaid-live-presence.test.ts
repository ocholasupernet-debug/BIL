import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLivePresenceByRouter,
  customerIsOnline,
  type PrepaidOnlineCustomer,
} from "./prepaid-live-presence";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");

test("online prepaid counts use the normalized live session from the shared router snapshot", () => {
  const presence = buildLivePresenceByRouter(
    [{ id: 7 }],
    [{
      isError: false,
      data: {
        fetchedAt: "2026-10-07T11:59:55.000Z",
        hotspotUsers: [{ user: "  Hotspot254700123456 " }],
        pppoeUsers: [{ name: "HomeUser" }],
      },
    }],
  );
  const hotspot: PrepaidOnlineCustomer = {
    id: 1,
    type: "hotspot",
    username: "hotspot254700123456",
    router_id: 7,
    status: "active",
    expires_at: "2026-10-08T00:00:00.000Z",
  };
  const pppoe: PrepaidOnlineCustomer = {
    id: 2,
    type: "pppoe",
    pppoe_username: "homeuser",
    router_id: 7,
    status: "active",
    expires_at: "2026-10-08T00:00:00.000Z",
  };

  assert.equal(customerIsOnline(hotspot, presence, {}, NOW), true);
  assert.equal(customerIsOnline(pppoe, presence, {}, NOW), true);
});

test("expired access and suspended prepaid records never count as online", () => {
  const presence = buildLivePresenceByRouter(
    [{ id: 7 }],
    [{ data: { fetchedAt: "2026-10-07T11:59:55.000Z", hotspotUsers: [{ user: "paid-user" }] } }],
  );
  const base: PrepaidOnlineCustomer = {
    id: 1,
    type: "hotspot",
    username: "paid-user",
    router_id: 7,
    expires_at: "2026-10-08T00:00:00.000Z",
  };

  assert.equal(customerIsOnline({
    ...base,
    status: "expired",
    expires_at: "2026-10-06T00:00:00.000Z",
  }, presence, {}, NOW), false);
  assert.equal(customerIsOnline({ ...base, status: "suspended" }, presence, {}, NOW), false);
  assert.equal(customerIsOnline({ ...base, status: "expired" }, presence, {}, NOW), true);
});

test("a failed router query falls back to the saved prepaid online state", () => {
  const presence = buildLivePresenceByRouter([{ id: 7 }], [{ isError: true }]);
  const user: PrepaidOnlineCustomer = {
    id: 1,
    type: "hotspot",
    username: "saved-online-user",
    router_id: 7,
    status: "active",
    expires_at: "2026-10-08T00:00:00.000Z",
    service_online: true,
  };

  assert.equal(customerIsOnline(user, presence, {}, NOW), true);
  assert.equal(customerIsOnline({ ...user, service_online: false }, presence, {}, NOW), false);
});
