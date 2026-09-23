import test from "node:test";
import assert from "node:assert/strict";
import { resellerTenantHostname, resellerTenantOrigin } from "./reseller-portal-hostname.js";

test("reseller portal hostname is derived from the reseller tenant", () => {
  assert.equal(resellerTenantOrigin("my-reseller"), "https://my-reseller.isplatty.org");
  assert.equal(resellerTenantHostname("my-reseller"), "my-reseller.isplatty.org");
});

test("invalid and platform subdomains cannot become reseller portal hosts", () => {
  assert.equal(resellerTenantOrigin("come-com"), "https://come-com.isplatty.org");
  assert.equal(resellerTenantHostname("come.com"), null);
  assert.equal(resellerTenantHostname("api"), null);
  assert.equal(resellerTenantHostname(""), null);
});