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

test("accepts only the supported loyalty card display controls", () => {
  assert.deepEqual(
    sanitizeHotspotBrandingSettings({
      loyaltyCard: {
        position: "after-packages",
        treatment: "glass",
        shape: "pill",
        size: "large",
        script: "discard",
      },
    }),
    {
      loyaltyCard: {
        position: "after-packages",
        treatment: "glass",
        shape: "pill",
        size: "large",
      },
    },
  );
  assert.deepEqual(
    sanitizeHotspotBrandingSettings({ loyaltyCard: { position: "javascript:alert(1)", size: 999 } }),
    { loyaltyCard: {} },
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
    sanitizeHotspotBrandingSettings({ portalLayout: "dansted-wifi" }),
    { portalLayout: "dansted-wifi" },
  );
  assert.deepEqual(
    sanitizeHotspotBrandingSettings({ portalLayout: "circuit-noir" }),
    { portalLayout: "circuit-noir" },
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

test("exposes only bounded free-access settings to public hotspot branding", () => {
  assert.deepEqual(
    sanitizeHotspotBrandingSettings({
      freeAccess: {
        active: true,
        speedDownMbps: 8,
        speedUpMbps: 2,
        dataLimitMb: 1200,
        activationId: "51c304dc-7bc8-4a2d-a39b-b2947677d112",
        routerSecret: "discard",
      },
    }),
    {
      freeAccess: {
        active: true,
        speedDownMbps: 8,
        speedUpMbps: 2,
        dataLimitMb: 1200,
        activationId: "51c304dc-7bc8-4a2d-a39b-b2947677d112",
      },
    },
  );
  assert.deepEqual(
    sanitizeHotspotBrandingSettings({
      freeAccess: {
        active: "true",
        speedDownMbps: 1001,
        speedUpMbps: 0,
        dataLimitMb: -1,
        activationId: "not-a-uuid",
      },
    }),
    { freeAccess: { active: false } },
  );
});

test("keeps only supported per-layout appearance settings and support contacts", () => {
  assert.deepEqual(
    sanitizeHotspotBrandingSettings({
      layoutAppearances: {
        classic: {
          portalBackground: "sand",
          portalPackageShape: "rounded",
          colors: { primaryColor: "#ABCDEF", invalid: "red" },
          script: "discard",
        },
        "dansted-wifi": {
          portalBackground: "midnight",
          portalPackageShape: "hexagon",
          colors: { buttonColor: "#40C965" },
        },
        "circuit-noir": {
          portalBackground: "midnight",
          portalPackageShape: "soft-square",
          colors: { primaryColor: "#42E8D5" },
        },
        retired: { portalBackground: "sunset" },
      },
      supportContacts: [
        { id: "one", label: "Care", phone: "0712345678", whatsapp: "254712345678", ignored: true },
        { id: "two", label: "Sales", phone: "", whatsapp: "254700000000" },
      ],
    }),
    {
      layoutAppearances: {
        classic: { portalBackground: "sand", portalPackageShape: "rounded", colors: { primaryColor: "#abcdef" } },
        "dansted-wifi": { portalBackground: "midnight", portalPackageShape: "hexagon", colors: { buttonColor: "#40c965" } },
        "circuit-noir": { portalBackground: "midnight", portalPackageShape: "soft-square", colors: { primaryColor: "#42e8d5" } },
      },
      supportContacts: [
        { id: "one", label: "Care", phone: "0712345678", whatsapp: "254712345678" },
        { id: "two", label: "Sales", phone: "", whatsapp: "254700000000" },
      ],
    },
  );
});
