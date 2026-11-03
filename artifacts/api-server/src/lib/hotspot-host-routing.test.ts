import assert from "node:assert/strict";
import test from "node:test";
import {
  injectHotspotHostConfig,
  isPlatformHostname,
  resolveHotspotHostMapping,
  type HotspotHostMapping,
} from "./hotspot-host-routing.js";

const ocholaMapping: HotspotHostMapping = {
  adminId: 33,
  portalHostname: "ocholasupernet.com",
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

test("custom Hotspot root receives only its mapped tenant bootstrap before app scripts", () => {
  const html = injectHotspotHostConfig(
    "<html><head><title>BIL</title><script type=\"module\">start()</script></head><body></body></html>",
    "ocholasupernet.com",
    ocholaMapping.adminId,
  );
  assert.match(html, /window\.__HOTSPOT_CONFIG__=\{"apiBase":"https:\/\/ocholasupernet\.com","adminId":33\}/);
  assert.ok(html.indexOf("window.__HOTSPOT_CONFIG__") < html.indexOf('type="module"'));
});
