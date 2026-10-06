import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeHotspotBrandingSettings } from "./hotspot-branding-settings.js";

test("keeps only allowlisted boolean hotspot card visibility settings", () => {
  const sanitized = sanitizeHotspotBrandingSettings({
    ispName: "Example ISP",
    tawkEnabled: true,
    unknownSetting: "discard",
    portalCards: {
      header: false,
      packages: true,
      voucher: "false",
      customCard: true,
    },
  });

  assert.deepEqual(sanitized, {
    ispName: "Example ISP",
    tawkEnabled: true,
    portalCards: {
      header: false,
      packages: true,
    },
  });
});

test("forces package checkout visible when legacy branding settings hid it", () => {
  assert.deepEqual(
    sanitizeHotspotBrandingSettings({ portalCards: { packages: false, voucher: false } }),
    { portalCards: { packages: true, voucher: false } },
  );
});

test("drops malformed portal card maps without discarding other branding settings", () => {
  const sanitized = sanitizeHotspotBrandingSettings({
    tagline: "Fast internet",
    portalCards: ["header", "footer"],
  });

  assert.deepEqual(sanitized, { tagline: "Fast internet" });
});

test("keeps only supported portal layout values", () => {
  assert.deepEqual(
    sanitizeHotspotBrandingSettings({
      portalLayout: "coastal-light",
      ignored: "discard",
    }),
    { portalLayout: "coastal-light" },
  );
  assert.deepEqual(
    sanitizeHotspotBrandingSettings({ portalLayout: "unknown-layout" }),
    {},
  );
});

test("accepts only boolean Tawk enablement values", () => {
  assert.deepEqual(sanitizeHotspotBrandingSettings({ tawkEnabled: true }), { tawkEnabled: true });
  assert.deepEqual(sanitizeHotspotBrandingSettings({ tawkEnabled: false }), { tawkEnabled: false });
  assert.deepEqual(sanitizeHotspotBrandingSettings({ tawkEnabled: "true" }), {});
});
