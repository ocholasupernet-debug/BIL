import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  HOSTED_PORTAL_LAYOUT_CSS,
  HOTSPOT_PORTAL_LAYOUTS,
  STATIC_PORTAL_LAYOUT_CSS_TEXT,
  normalizeHotspotPortalLayout,
  renderStaticPortalLayoutCss,
} from "./hotspot-layouts.js";

test("the portal layout registry keeps existing choices and adds Aurora Network", () => {
  assert.equal(HOTSPOT_PORTAL_LAYOUTS.length, 9);
  assert.equal(HOTSPOT_PORTAL_LAYOUTS[0].value, "classic");
  assert.deepEqual(
    HOTSPOT_PORTAL_LAYOUTS.slice(1).map(layout => layout.label),
    ["Split Horizon", "Coastal Light", "Signal Grid", "Warm Studio", "Forest Pulse", "Metallic Diamond", "Circuit Noir", "Aurora Network"],
  );
  const settings = readFileSync(new URL("../pages/admin/HotspotSettings.tsx", import.meta.url), "utf8");
  assert.match(settings, /layout\.value === "classic" \|\| layout\.value === "dansted-wifi" \|\| layout\.value === "circuit-noir" \|\| layout\.value === "aurora-network"/);
  assert.match(settings, /type SupportedPortalLayout = "classic" \| "dansted-wifi" \| "circuit-noir" \| "aurora-network"/);
  assert.match(settings, /"circuit-noir": normalizeOne\("circuit-noir"\)/);
});

test("unknown or legacy layout values fall back to the existing Classic design", () => {
  assert.equal(normalizeHotspotPortalLayout(undefined), "classic");
  assert.equal(normalizeHotspotPortalLayout("legacy-dark-portal"), "classic");
  assert.equal(normalizeHotspotPortalLayout("split-horizon"), "split-horizon");
  assert.match(renderStaticPortalLayoutCss(undefined), /data-portal-layout="classic"/);
});

test("existing style presets retain generated-portal and hosted-page styling", () => {
  for (const layout of HOTSPOT_PORTAL_LAYOUTS.slice(1, -1)) {
    assert.match(renderStaticPortalLayoutCss(layout.value), new RegExp(`data-portal-layout="${layout.value}"`));
    assert.match(STATIC_PORTAL_LAYOUT_CSS_TEXT, new RegExp(`data-portal-layout="${layout.value}"`));
    assert.match(HOSTED_PORTAL_LAYOUT_CSS, new RegExp(`data-portal-layout="${layout.value}"`));
  }
});

test("Classic and Dansted have separate self-contained login and handoff files", () => {
  for (const id of ["classic", "dansted-wifi"]) {
    const base = new URL(`../../public/hotspot/layouts/${id}/`, import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL("manifest.json", base), "utf8")) as {
      id: string; entry: string; handoff: string; assets: string[]; standalone: boolean; independentFiles: boolean;
    };
    const login = readFileSync(new URL("login.html", base), "utf8");
    const rlogin = readFileSync(new URL("rlogin.html", base), "utf8");
    assert.equal(manifest.id, id);
    assert.equal(manifest.entry, "login.html");
    assert.equal(manifest.handoff, "rlogin.html");
    assert.equal(manifest.standalone, true);
    assert.equal(manifest.independentFiles, true);
    assert.ok(manifest.assets.includes("md5.js"));
    assert.match(login, new RegExp(`data-portal-layout="${id}"`));
    assert.match(login, new RegExp(`/hotspot/layouts/${id}/md5\\.js`));
    assert.doesNotMatch(login, /src=["']\/hotspot\/md5\.js["']/);
    assert.match(rlogin, new RegExp(`data-bil-layout-package="${id}"`));
    assert.notEqual(login, rlogin);
  }
});