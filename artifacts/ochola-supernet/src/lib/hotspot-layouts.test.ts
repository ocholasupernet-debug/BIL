import assert from "node:assert/strict";
import test from "node:test";
import {
  HOSTED_PORTAL_LAYOUT_CSS,
  HOTSPOT_PORTAL_LAYOUTS,
  STATIC_PORTAL_LAYOUT_CSS_TEXT,
  normalizeHotspotPortalLayout,
  renderStaticPortalLayoutCss,
} from "./hotspot-layouts.js";

test("the portal layout list keeps Classic first and provides five alternatives", () => {
  assert.equal(HOTSPOT_PORTAL_LAYOUTS.length, 6);
  assert.equal(HOTSPOT_PORTAL_LAYOUTS[0].value, "classic");
  assert.deepEqual(
    HOTSPOT_PORTAL_LAYOUTS.slice(1).map(layout => layout.label),
    ["Split Horizon", "Coastal Light", "Signal Grid", "Warm Studio", "Forest Pulse"],
  );
});

test("unknown or legacy layout values fall back to the existing Classic design", () => {
  assert.equal(normalizeHotspotPortalLayout(undefined), "classic");
  assert.equal(normalizeHotspotPortalLayout("legacy-dark-portal"), "classic");
  assert.equal(normalizeHotspotPortalLayout("split-horizon"), "split-horizon");
  assert.match(renderStaticPortalLayoutCss(undefined), /data-portal-layout="classic"/);
});

test("every alternative has generated-portal and hosted-page styling", () => {
  for (const layout of HOTSPOT_PORTAL_LAYOUTS.slice(1)) {
    assert.match(renderStaticPortalLayoutCss(layout.value), new RegExp(`data-portal-layout="${layout.value}"`));
    assert.match(STATIC_PORTAL_LAYOUT_CSS_TEXT, new RegExp(`data-portal-layout="${layout.value}"`));
    assert.match(HOSTED_PORTAL_LAYOUT_CSS, new RegExp(`data-portal-layout="${layout.value}"`));
  }
});