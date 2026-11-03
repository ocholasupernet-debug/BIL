import assert from "node:assert/strict";
import test from "node:test";
import { getTenantSubdomain } from "./tenant-host.js";

test("tenant host resolution accepts both migration domains", () => {
  assert.equal(getTenantSubdomain("fastnet.isplatty.org"), "fastnet");
  assert.equal(getTenantSubdomain("fastnet.isplatty.com"), "fastnet");
});

test("base and service hostnames do not resolve as tenants", () => {
  for (const host of [
    "isplatty.org",
    "isplatty.com",
    "www.isplatty.com",
    "api.isplatty.com",
    "admin.isplatty.com",
    "come.isplatty.com",
    "vpn.isplatty.org",
  ]) {
    assert.equal(getTenantSubdomain(host), null, host);
  }
});

test("tenant host resolution rejects nested and malformed labels", () => {
  assert.equal(getTenantSubdomain("nested.fastnet.isplatty.com"), null);
  assert.equal(getTenantSubdomain("-fastnet.isplatty.com"), null);
  assert.equal(getTenantSubdomain("fastnet.other.example"), null);
});
