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