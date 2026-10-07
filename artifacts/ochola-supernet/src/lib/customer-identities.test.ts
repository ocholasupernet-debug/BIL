import assert from "node:assert/strict";
import test from "node:test";
import { mergeCustomerServiceIdentities } from "./customer-identities";
import { getCustomerServiceStatus } from "./customer-service-status";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");

test("one hotspot identity uses the newest matching record for its active count", () => {
  const customers = [
    {
      id: 1,
      type: "hotspot",
      router_id: 7,
      port_id: 2,
      mac_address: "FE:9F:05:D6:CF:DE",
      phone: "+254 700 123 456",
      status: "active",
      expires_at: "2026-10-10T00:00:00.000Z",
      created_at: "2026-10-06T10:00:00.000Z",
    },
    {
      id: 2,
      type: "hotspot",
      router_id: 7,
      port_id: 2,
      mac_address: "fe-9f-05-d6-cf-de",
      phone: "254700123456",
      status: "expired",
      expires_at: "2026-10-06T00:00:00.000Z",
      created_at: "2026-10-07T10:00:00.000Z",
    },
  ];

  const uniqueCustomers = mergeCustomerServiceIdentities(customers, {});
  const activeCount = uniqueCustomers.filter(
    customer => getCustomerServiceStatus(customer, NOW) === "active",
  ).length;

  assert.equal(uniqueCustomers.length, 1);
  assert.equal(uniqueCustomers[0].id, 2);
  assert.equal(activeCount, 0);
});

test("hotspot identities remain separate across phone numbers and port scopes", () => {
  const base = {
    type: "hotspot",
    router_id: 7,
    port_id: 2,
    mac_address: "FE:9F:05:D6:CF:DE",
    status: "active",
    expires_at: "2026-10-10T00:00:00.000Z",
    created_at: "2026-10-07T10:00:00.000Z",
  };
  const customers = [
    { ...base, id: 1, phone: "254700123456" },
    { ...base, id: 2, phone: "254700654321" },
    { ...base, id: 3, port_id: 3, phone: "254700123456" },
  ];

  const uniqueCustomers = mergeCustomerServiceIdentities(customers, {});
  const activeCount = uniqueCustomers.filter(
    customer => getCustomerServiceStatus(customer, NOW) === "active",
  ).length;

  assert.equal(uniqueCustomers.length, 3);
  assert.equal(activeCount, 3);
});

test("identity scope falls back to the linked plan router and port", () => {
  const customers = [
    {
      id: 1,
      type: "pppoe",
      plan_id: 10,
      username: "HomeUser",
      status: "active",
      expires_at: "2026-10-10T00:00:00.000Z",
      created_at: "2026-10-06T10:00:00.000Z",
    },
    {
      id: 2,
      type: "pppoe",
      plan_id: 11,
      username: "homeuser",
      status: "active",
      expires_at: "2026-10-10T00:00:00.000Z",
      created_at: "2026-10-06T11:00:00.000Z",
    },
  ];
  const plans = {
    10: { router_id: 7, port_id: 2 },
    11: { router_id: 7, port_id: 2 },
  };

  const uniqueCustomers = mergeCustomerServiceIdentities(customers, plans);
  const activeCount = uniqueCustomers.filter(
    customer => getCustomerServiceStatus(customer, NOW) === "active",
  ).length;

  assert.equal(uniqueCustomers.length, 1);
  assert.equal(activeCount, 1);
});
