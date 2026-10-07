import assert from "node:assert/strict";
import test from "node:test";
import { getTenantSubdomain } from "./tenant-host";

test("resolves normal tenant subdomains", () => {
  assert.equal(getTenantSubdomain("come.isplatty.org"), "come");
  assert.equal(getTenantSubdomain("isplatty.org"), null);
  assert.equal(getTenantSubdomain("admin.isplatty.org"), null);
});

test("resolves the configured custom tenant domain and its www alias", () => {
  const previousDomain = process.env.CUSTOM_TENANT_DOMAIN;
  const previousSubdomain = process.env.CUSTOM_TENANT_SUBDOMAIN;
  process.env.CUSTOM_TENANT_DOMAIN = "come.org";
  process.env.CUSTOM_TENANT_SUBDOMAIN = "come";

  try {
    assert.equal(getTenantSubdomain("come.org"), "come");
    assert.equal(getTenantSubdomain("www.come.org"), "come");
    assert.equal(getTenantSubdomain("other.org"), null);
  } finally {
    if (previousDomain === undefined) delete process.env.CUSTOM_TENANT_DOMAIN;
    else process.env.CUSTOM_TENANT_DOMAIN = previousDomain;
    if (previousSubdomain === undefined) delete process.env.CUSTOM_TENANT_SUBDOMAIN;
    else process.env.CUSTOM_TENANT_SUBDOMAIN = previousSubdomain;
  }
});