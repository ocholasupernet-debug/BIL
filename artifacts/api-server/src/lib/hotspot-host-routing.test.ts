import assert from "node:assert/strict";
import test from "node:test";
import {
  injectHotspotHostConfig,
  isPlatformHostname,
  resolveTenantBaseDomain,
  resolveHotspotHostMapping,
  resolveTenantMemberPortalMapping,
  type HotspotHostMapping,
  type TenantMemberPortalMapping,
} from "./hotspot-host-routing.js";

const ocholaMapping: HotspotHostMapping = {
  adminId: 33,
  portalHostname: "ocholasupernet.com",
  subdomain: "ocholasupernet",
  isActive: true,
  status: "active",
};

const ocholaTenant: TenantMemberPortalMapping = {
  adminId: 33,
  subdomain: "ocholasupernet",
  isActive: true,
  status: "active",
};

test("a customer .com portal maps only through its saved active tenant hostname", () => {
  assert.equal(
    resolveHotspotHostMapping("OCHOLASUPERNET.COM:443", [ocholaMapping])?.adminId,
    33,
  );
  assert.equal(resolveHotspotHostMapping("other.com", [ocholaMapping]), null);
  assert.equal(resolveHotspotHostMapping("ocholasupernet.isplatty.com", [ocholaMapping]), null);
  assert.equal(
    resolveHotspotHostMapping("ocholasupernet.com", [{ ...ocholaMapping, status: "pending" }]),
    null,
  );
  assert.equal(
    resolveHotspotHostMapping("ocholasupernet.com", [ocholaMapping, ocholaMapping]),
    null,
  );
});

test("platform tenant and admin hosts are never classified as custom Hotspot hosts", () => {
  assert.equal(isPlatformHostname("ocholasupernet.isplatty.com", ["isplatty.com", "isplatty.org"]), true);
  assert.equal(isPlatformHostname("admin.isplatty.com", ["isplatty.com", "isplatty.org"]), true);
  assert.equal(isPlatformHostname("ocholasupernet.com", ["isplatty.com", "isplatty.org"]), false);
});

test("member portal admin links stay on the tenant's requested base domain", () => {
  const baseDomains = ["isplatty.com", "isplatty.org"];
  assert.equal(
    resolveTenantBaseDomain("ocholasupernet.isplatty.com:443", baseDomains, "isplatty.com"),
    "isplatty.com",
  );
  assert.equal(
    resolveTenantBaseDomain("ocholasupernet.isplatty.org", baseDomains, "isplatty.com"),
    "isplatty.org",
  );
  assert.equal(resolveTenantBaseDomain("isplatty.com", baseDomains, "isplatty.com"), "isplatty.com");
});

test("an active ISP tenant subdomain resolves to its member portal mapping", () => {
  assert.equal(
    resolveTenantMemberPortalMapping("OCHOLASUPERNET.ISPLATTY.COM:443", [ocholaTenant])?.adminId,
    33,
  );
  assert.equal(resolveTenantMemberPortalMapping("isplatty.com", [ocholaTenant]), null);
  assert.equal(resolveTenantMemberPortalMapping("staff.isplatty.com", [ocholaTenant]), null);
  assert.equal(resolveTenantMemberPortalMapping("other.isplatty.com", [ocholaTenant]), null);
  assert.equal(
    resolveTenantMemberPortalMapping("ocholasupernet.isplatty.com", [ocholaTenant, ocholaTenant]),
    null,
  );
  assert.equal(
    resolveTenantMemberPortalMapping("ocholasupernet.isplatty.com", [{ ...ocholaTenant, isActive: false }]),
    null,
  );
});

test("custom Hotspot root receives only its mapped tenant bootstrap before app scripts", () => {
  const html = injectHotspotHostConfig(
    "<html><head><title>BIL</title><script type=\"module\">start()</script></head><body></body></html>",
    "ocholasupernet.com",
    ocholaMapping.adminId,
    ocholaMapping.subdomain,
    "isplatty.com",
  );
  assert.match(html, /window\.__HOTSPOT_CONFIG__=\{"apiBase":"https:\/\/ocholasupernet\.com","adminId":33,"adminLoginUrl":"https:\/\/ocholasupernet\.isplatty\.com\/admin\/login"\}/);
  assert.ok(html.indexOf("window.__HOTSPOT_CONFIG__") < html.indexOf('type="module"'));
});

test("custom portal bootstrap excludes unsafe tenant subdomains", () => {
  const html = injectHotspotHostConfig(
    "<html><head></head><body></body></html>",
    "ocholasupernet.com",
    ocholaMapping.adminId,
    "<script>alert(1)</script>",
    "isplatty.com",
  );
  assert.match(html, /window\.__HOTSPOT_CONFIG__=\{"apiBase":"https:\/\/ocholasupernet\.com","adminId":33\}/);
  assert.doesNotMatch(html, /adminLoginUrl/);
});

test("tenant subdomain bootstrap marks the first page as the member login", () => {
  const html = injectHotspotHostConfig(
    "<html><head></head><body></body></html>",
    "ocholasupernet.isplatty.com",
    ocholaTenant.adminId,
    ocholaTenant.subdomain,
    "isplatty.com",
    "member-login",
  );
  assert.match(
    html,
    /window\.__HOTSPOT_CONFIG__=\{"apiBase":"https:\/\/ocholasupernet\.isplatty\.com","adminId":33,"portalMode":"member-login","adminLoginUrl":"https:\/\/ocholasupernet\.isplatty\.com\/admin\/login"\}/,
  );
});

test("custom portal bootstrap omits an admin link for unknown base domains", () => {
  const html = injectHotspotHostConfig(
    "<html><head></head><body></body></html>",
    "ocholasupernet.com",
    ocholaMapping.adminId,
    ocholaMapping.subdomain,
    "attacker.example",
  );
  assert.match(html, /window\.__HOTSPOT_CONFIG__=\{"apiBase":"https:\/\/ocholasupernet\.com","adminId":33\}/);
});
