import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_HOTSPOT_LOYALTY_CARD_SETTINGS,
  normalizeHotspotLoyaltyCardSettings,
  normalizeHotspotPortalCards,
} from "./hotspot-portal-cards.js";

test("customer package checkout stays visible when old branding settings disabled it", () => {
  const cards = normalizeHotspotPortalCards({
    packages: false,
    voucher: false,
  });

  assert.equal(cards.packages, true);
  assert.equal(cards.voucher, false);
  assert.equal(cards.loyalty, true);
});

test("loyalty card visibility can be disabled by portal settings", () => {
  assert.equal(normalizeHotspotPortalCards({ loyalty: false }).loyalty, false);
});

test("loyalty card display settings accept only supported layout values", () => {
  assert.deepEqual(
    normalizeHotspotLoyaltyCardSettings({
      position: "after-packages",
      treatment: "glass",
      shape: "pill",
      size: "large",
    }),
    { position: "after-packages", treatment: "glass", shape: "pill", size: "large" },
  );
  assert.deepEqual(
    normalizeHotspotLoyaltyCardSettings({ position: "bottom;display:none", treatment: "url(x)", size: 5 }),
    DEFAULT_HOTSPOT_LOYALTY_CARD_SETTINGS,
  );
});