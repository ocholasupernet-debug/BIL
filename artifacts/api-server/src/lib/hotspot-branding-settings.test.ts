import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeHotspotBrandingSettings } from "./hotspot-branding-settings.js";

test("keeps only allowlisted boolean hotspot card visibility settings", () => {
  const sanitized = sanitizeHotspotBrandingSettings({
    ispName: "Example ISP",
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
    portalCards: {
      header: false,
      packages: true,
    },
  });
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
