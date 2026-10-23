import assert from "node:assert/strict";
import test from "node:test";
import {
  HOSTED_PORTAL_LAYOUT_CSS,
  HOTSPOT_PORTAL_LAYOUTS,
  STATIC_PORTAL_LAYOUT_CSS_TEXT,
  normalizeHotspotPortalLayout,
  renderStaticPortalLayoutCss,
} from "./hotspot-layouts.js";

test("the portal layout list keeps every existing choice unchanged and appends Dansted WiFi", () => {
  assert.equal(HOTSPOT_PORTAL_LAYOUTS.length, 8);
  assert.equal(HOTSPOT_PORTAL_LAYOUTS[0].value, "classic");
  assert.deepEqual(
    HOTSPOT_PORTAL_LAYOUTS.slice(0, 6),
    [
      {
        value: "classic",
        label: "Classic",
        description: "A warm, light guest portal with clear plan cards and a welcoming feel.",
        background: "#f3f4ec",
        panel: "#ffffff",
        accent: "#d56c4c",
      },
      {
        value: "split-horizon",
        label: "Split Horizon",
        description: "Place the welcome message beside the plans and sign-in options.",
        background: "#0b1623",
        panel: "#16283b",
        accent: "#38bdf8",
      },
      {
        value: "coastal-light",
        label: "Coastal Light",
        description: "Use bright surfaces, clear text, and a calm, spacious layout.",
        background: "#eaf4fa",
        panel: "#ffffff",
        accent: "#0284c7",
      },
      {
        value: "signal-grid",
        label: "Signal Grid",
        description: "Use a compact, square-edged layout with crisp network accents.",
        background: "#07191b",
        panel: "#102a2b",
        accent: "#2dd4bf",
      },
      {
        value: "warm-studio",
        label: "Warm Studio",
        description: "Use soft warm surfaces and friendly, rounded plan cards.",
        background: "#2a2019",
        panel: "#413126",
        accent: "#fb923c",
      },
      {
        value: "forest-pulse",
        label: "Forest Pulse",
        description: "Use deep green surfaces, vivid highlights, and a bold hero.",
        background: "#071910",
        panel: "#102a1c",
        accent: "#4ade80",
      },
    ],
  );
  assert.deepEqual(
    HOTSPOT_PORTAL_LAYOUTS[6],
    {
      value: "night-market",
      label: "Night Market",
      description: "A textured dark portal with bright green branding and compact outlined packages.",
      background: "#101112",
      panel: "#292b2c",
      accent: "#39e75f",
    },
  );
  assert.deepEqual(HOTSPOT_PORTAL_LAYOUTS[7], {
    value: "dansted-wifi",
    label: "Dansted WiFi",
    description: "A compact metallic portal with centered branding and outlined package tiles.",
    background: "#151617",
    panel: "#363738",
    accent: "#41d85f",
  });
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

test("Night Market normalizes as an optional layout and emits scoped hosted and RouterOS styling", () => {
  assert.equal(normalizeHotspotPortalLayout("night-market"), "night-market");
  assert.equal(normalizeHotspotPortalLayout("not-a-layout"), "classic");

  const staticCss = renderStaticPortalLayoutCss("night-market");
  assert.match(staticCss, /html\[data-portal-layout="night-market"\]/);
  assert.match(staticCss, /repeating-linear-gradient/);
  assert.match(staticCss, /#39e75f/);
  assert.match(staticCss, /@media \(max-width: 640px\)/);

  const hostedNightMarket = HOSTED_PORTAL_LAYOUT_CSS.split(
    '.hp-root[data-portal-layout="night-market"]',
  ).slice(1).join("");
  assert.notEqual(hostedNightMarket, "");
  assert.match(hostedNightMarket, /repeating-linear-gradient/);
  assert.match(hostedNightMarket, /\.hp-plan/);
  assert.match(hostedNightMarket, /\.hp-btn/);
  assert.match(hostedNightMarket, /@media \(max-width:760px\)/);
});

test("Dansted WiFi emits independently scoped hosted and responsive RouterOS styling", () => {
  assert.equal(normalizeHotspotPortalLayout("dansted-wifi"), "dansted-wifi");

  const staticCss = renderStaticPortalLayoutCss("dansted-wifi");
  assert.match(staticCss, /html\[data-portal-layout="dansted-wifi"\]/);
  assert.match(staticCss, /repeating-linear-gradient/);
  assert.match(staticCss, /#plansGrid/);
  assert.match(staticCss, /#loyaltyPointsCard/);
  assert.match(staticCss, /html\[data-portal-layout="dansted-wifi"\] \.hdr \{ display:none !important; \}/);
  assert.match(staticCss, /#portalHero \{\s*padding:\.2rem/);
  assert.match(staticCss, /#portalTagline ol/);
  assert.match(staticCss, /@media \(max-width:640px\)/);
  assert.doesNotMatch(staticCss, /html\[data-portal-layout="night-market"\]/);

  const hostedDansted = HOSTED_PORTAL_LAYOUT_CSS.split(
    '.hp-root[data-portal-layout="dansted-wifi"]',
  ).slice(1).join("");
  assert.notEqual(hostedDansted, "");
  assert.match(hostedDansted, /repeating-linear-gradient/);
  assert.match(hostedDansted, /\.hp-plan/);
  assert.match(hostedDansted, /\[aria-labelledby="hp-loyalty-balance-title"\]/);
  assert.match(HOSTED_PORTAL_LAYOUT_CSS, /\.hp-root\[data-portal-layout="dansted-wifi"\] \.hp-purchase-instructions ol/);
  assert.match(hostedDansted, /@media \(max-width:760px\)/);
  assert.match(HOSTED_PORTAL_LAYOUT_CSS, /\.hp-root\[data-portal-layout="dansted-wifi"\] \.hp-plan/);
  assert.match(
    HOSTED_PORTAL_LAYOUT_CSS,
    /\.hp-root\[data-portal-layout="dansted-wifi"\] \.hp-header,\s*\.hp-root\[data-portal-layout="dansted-wifi"\] \.hp-tabs \{ display:none !important; \}/,
  );
});