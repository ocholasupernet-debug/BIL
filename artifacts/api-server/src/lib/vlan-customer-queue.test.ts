import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidIpv4,
  isValidSimpleQueueRateLimit,
  isValidVlanTag,
  ipv4InSubnet,
  isVlanCustomerQueueName,
  parseVlanQueueCounters,
  vlanCustomerQueueIdentity,
  vlanQueueHasTraffic,
} from "./vlan-customer-queue.js";

test("validates VLAN tags and assigned IPv4 addresses", () => {
  assert.equal(isValidVlanTag("1"), true);
  assert.equal(isValidVlanTag(4094), true);
  assert.equal(isValidVlanTag("0"), false);
  assert.equal(isValidVlanTag("4095"), false);
  assert.equal(isValidVlanTag("12x"), false);

  assert.equal(isValidIpv4("192.168.10.50"), true);
  assert.equal(isValidIpv4("192.168.010.50"), false);
  assert.equal(isValidIpv4("192.168.10.256"), false);
  assert.equal(ipv4InSubnet("192.168.10.50", "192.168.10.0/24"), true);
  assert.equal(ipv4InSubnet("192.168.11.50", "192.168.10.0/24"), false);
});

test("builds an owned RouterOS queue identity scoped to the customer and IP", () => {
  const identity = vlanCustomerQueueIdentity(14, 87, "192.168.10.50");
  assert.equal(identity.name, "ochola-vlan-14-87-192-168-10-50");
  assert.equal(identity.target, "192.168.10.50/32");
  assert.equal(identity.comment, "ochola-vlan-customer:14:87:192.168.10.50");
  assert.equal(isVlanCustomerQueueName(identity.name), true);
  assert.throws(() => vlanCustomerQueueIdentity(14, 87, "192.168.10.999"), /valid assigned IPv4/i);
  assert.equal(isVlanCustomerQueueName("customer-owned-queue"), false);
});

test("validates per-customer queue speed and parses real queue counters", () => {
  assert.equal(isValidSimpleQueueRateLimit("10M/20M"), true);
  assert.equal(isValidSimpleQueueRateLimit("512k/2M"), true);
  assert.equal(isValidSimpleQueueRateLimit("0M/20M"), false);
  assert.equal(isValidSimpleQueueRateLimit("fast/slow"), false);
  assert.deepEqual(parseVlanQueueCounters("123/456"), { bytesIn: 123, bytesOut: 456 });
  assert.deepEqual(parseVlanQueueCounters(undefined, "123", "456"), { bytesIn: 123, bytesOut: 456 });
  assert.equal(parseVlanQueueCounters("unknown"), null);
  assert.equal(vlanQueueHasTraffic("1/0"), true);
  assert.equal(vlanQueueHasTraffic("0/0"), false);
});