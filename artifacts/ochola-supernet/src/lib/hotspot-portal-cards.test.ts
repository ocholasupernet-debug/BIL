import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHotspotPortalCards } from "./hotspot-portal-cards.js";

test("customer package checkout stays visible when old branding settings disabled it", () => {
  const cards = normalizeHotspotPortalCards({
    packages: false,
    voucher: false,
  });

  assert.equal(cards.packages, true);
  assert.equal(cards.voucher, false);
});