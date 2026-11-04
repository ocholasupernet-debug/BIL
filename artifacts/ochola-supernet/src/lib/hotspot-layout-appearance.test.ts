import assert from "node:assert/strict";
import test from "node:test";
import { resolveHotspotLayoutColors } from "./hotspot-layout-appearance.js";

const defaults = { background: "#111111", accent: "#ffffff" };

test("Classic and Dansted resolve only their own saved color palettes", () => {
  const appearances = {
    classic: { colors: { background: "#f4f4ed", accent: "#d9684c" } },
    "dansted-wifi": { colors: { background: "#252729", accent: "#40c965" } },
  };
  const legacyColors = { background: "#252729", accent: "#40c965" };

  assert.deepEqual(
    resolveHotspotLayoutColors("classic", "dansted-wifi", appearances, legacyColors, defaults),
    { background: "#f4f4ed", accent: "#d9684c" },
  );
  assert.deepEqual(
    resolveHotspotLayoutColors("dansted-wifi", "dansted-wifi", appearances, legacyColors, defaults),
    { background: "#252729", accent: "#40c965" },
  );
});

test("legacy colors are only a fallback for their own active layout", () => {
  assert.deepEqual(
    resolveHotspotLayoutColors("classic", "dansted-wifi", {}, { accent: "#40c965" }, defaults),
    defaults,
  );
  assert.deepEqual(
    resolveHotspotLayoutColors("dansted-wifi", "dansted-wifi", {}, { accent: "#40c965" }, defaults),
    { ...defaults, accent: "#40c965" },
  );
});
