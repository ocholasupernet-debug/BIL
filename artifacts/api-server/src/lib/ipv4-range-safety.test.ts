import assert from "node:assert/strict";
import test from "node:test";
import { ipv4AddressNumber, ipv4RangesOverlap, parseIpv4Ranges } from "./ipv4-range-safety.js";

test("parses RouterOS pool ranges and detects overlaps", () => {
  const pool = parseIpv4Ranges("192.168.180.10-192.168.183.254,10.0.0.0/24");
  assert.equal(pool.length, 2);
  assert.equal(ipv4RangesOverlap(pool[0], parseIpv4Ranges("192.168.182.1-192.168.182.10")[0]), true);
  assert.equal(ipv4RangesOverlap(pool[0], parseIpv4Ranges("192.168.192.10-192.168.192.254")[0]), false);
});

test("parses assigned addresses and rejects malformed IPv4 ranges", () => {
  assert.equal(ipv4AddressNumber("192.168.193.20"), 3_232_284_948);
  assert.throws(() => parseIpv4Ranges("192.168.193.250-192.168.193.10"), /Invalid IPv4 address range/);
  assert.throws(() => parseIpv4Ranges("192.168.999.1-192.168.999.2"), /Invalid IPv4 address range/);
});
