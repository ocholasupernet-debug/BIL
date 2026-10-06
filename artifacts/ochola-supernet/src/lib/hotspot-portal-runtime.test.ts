import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portalTemplate = readFileSync(
  new URL("../../public/hotspot/login.html", import.meta.url),
  "utf8",
);

test("the standalone portal applies background and package shape from typography settings", () => {
  const typographyHandler = portalTemplate.match(/function applyPortalTypography\(data\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(typographyHandler, /applyPortalBackground\(data\.portalBackground\)/);
  assert.match(typographyHandler, /normalisePortalPackageShape\(data\.portalPackageShape\)/);
  assert.match(portalTemplate, /style\.setProperty\("background",backgrounds\[PORTAL_BACKGROUND\],"important"\)/);
});

test("the standalone portal applies saved layouts using the shared stylesheet asset", () => {
  assert.match(portalTemplate, /function normalisePortalLayout\(value\)/);
  assert.match(portalTemplate, /applyPortalLayout\(data\.portalLayout\)/);
  assert.match(portalTemplate, /hotspot\/portal-layouts\.css/);
  assert.match(portalTemplate, /if\(document\.getElementById\("hotspot-portal-layout"\)\)return/);
});

test("the standalone portal applies the saved ISP or reseller name as soon as branding loads", () => {
  const brandingHandler = portalTemplate.match(/function applyPublicHotspotBranding\(brandingData\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const loader = portalTemplate.match(/function loadPortalTypography\(done\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(brandingHandler, /brandingData&&brandingData\.branding&&brandingData\.branding\.settings/);
  assert.match(brandingHandler, /applyPortalConfig\(merged\)/);
  assert.match(loader, /var brandingRequest=brandingUrl\?fetch/);
  assert.match(loader, /applyPublicHotspotBranding\(data\);return data;/);
  assert.match(portalTemplate, /if\(token\)headers\.set\("X-Hotspot-Portal-Context",token\)/);
});

test("the captive portal reconnects a valid device session and keeps payment handoff separate", () => {
  assert.match(portalTemplate, /function attemptPortalAutoReconnect\(\)/);
  assert.match(portalTemplate, /action:"login"/);
  assert.match(portalTemplate, /router_id:PORTAL_ROUTER_ID/);
  assert.match(portalTemplate, /port_id:PORTAL_PORT_ID/);
  assert.match(portalTemplate, /data\.connected===true/);
  assert.match(portalTemplate, /window\.addEventListener\("online",retryPortalAutoReconnectOnReturn\)/);
  assert.match(portalTemplate, /if\(!portalPaidHandoffStarted\)attemptPortalAutoReconnect\(\)/);
  assert.match(portalTemplate, /data\.status==="expired"\|\|data\.status==="depleted"/);
});