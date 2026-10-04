import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { prepareIspHotspotAsset } from "./isp-hotspot-asset.js";
import { findEmbeddedHotspotConfig } from "./hotspot-portal-deploy.js";

const template = Buffer.from("<html><head></head><body>$(identity) $(server-name)</body></html>");
const scope = { adminId: 3, routerId: 85, apiBase: "https://tenant.example.test" };

test("default ISP template receives its exact scope and real purchasable packages", async () => {
  const output = await prepareIspHotspotAsset("login.html", template, scope, async <T>(table: string, query: string): Promise<T[]> => {
    assert.equal(table, "isp_plans");
    for (const filter of ["admin_id=eq.3", "router_id=eq.85", "port_id=is.null", "owner_reseller_id=is.null", "client_can_purchase=is.true", "is_active=is.true"]) {
      assert.ok(query.includes(filter), filter);
    }
    return [{ id: 1, name: "</script> Package", price: 10, validity: 1, validity_unit: "Hours" }] as T[];
  });
  const html = output.toString();
  const config = findEmbeddedHotspotConfig(html)?.config;
  assert.equal(config?.routerId, 85);
  assert.equal(config?.adminId, 3);
  assert.equal(config?.portId, 0);
  assert.equal(config?.apiBase, scope.apiBase);
  assert.equal((config?.plans as unknown[]).length, 1);
  assert.ok(html.includes("$(identity) $(server-name)"));
  assert.ok(!html.includes("</script> Package"));
});

test("static assets are unchanged and perform no database reads", async () => {
  const output = await prepareIspHotspotAsset("md5.js", template, scope, async () => {
    throw new Error("must not query");
  });
  assert.equal(output, template);
});

test("database failures prevent distributing an empty or unconfigured portal", async () => {
  await assert.rejects(prepareIspHotspotAsset("login.html", template, scope, async () => {
    throw new Error("Database unavailable");
  }), /Database unavailable/);
});

test("reject invalid scope and unsafe API origins", async () => {
  await assert.rejects(prepareIspHotspotAsset("login.html", template, { ...scope, routerId: 0 }), /valid ISP and router/);
  await assert.rejects(prepareIspHotspotAsset("login.html", template, { ...scope, apiBase: "http://localhost:8080" }), /public HTTPS/);
});

test("does not replace signed or previously configured portals", async () => {
  const configured = Buffer.from('<head><script>window.__HOTSPOT_CONFIG__={"portId":8};</script></head>');
  await assert.rejects(prepareIspHotspotAsset("login.html", configured, scope), /unconfigured default/);
});

test("Self Install, single upload and bulk upload all personalize the default asset", () => {
  const route = readFileSync(new URL("../routes/mikrotik-route.ts", import.meta.url), "utf8");
  assert.equal((route.match(/await prepareIspHotspotAsset\(/g) ?? []).length, 3);
  assert.match(route, /content: configuredContent/);
  assert.match(route, /return \{ \.\.\.file, content \}/);
});