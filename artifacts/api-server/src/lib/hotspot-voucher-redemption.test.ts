import assert from "node:assert/strict";
import test from "node:test";
import {
  formatVoucherExpiryInEastAfrica,
  hotspotVoucherIdentityKey,
  voucherExpiryFromEastAfricaDate,
} from "./hotspot-voucher-redemption.js";

test("voucher identity is stable for Kenyan phone formats and normalized MAC addresses", () => {
  assert.equal(
    hotspotVoucherIdentityKey("0712345678", "aa-bb-cc-dd-ee-ff"),
    "phone:254712345678",
  );
  assert.equal(
    hotspotVoucherIdentityKey("", "AA:BB:CC:DD:EE:FF"),
    "mac:AABBCCDDEEFF",
  );
  assert.equal(hotspotVoucherIdentityKey("", "not-a-mac"), null);
});

test("date-only voucher deadlines end at 23:59:59.999 East Africa Time", () => {
  assert.equal(
    voucherExpiryFromEastAfricaDate("2026-10-08"),
    "2026-10-08T20:59:59.999Z",
  );
  assert.equal(voucherExpiryFromEastAfricaDate("2026-02-30"), null);
  assert.equal(voucherExpiryFromEastAfricaDate("not-a-date"), null);
});

test("expiry messages render the deadline in East Africa Time", () => {
  const message = formatVoucherExpiryInEastAfrica("2026-10-08T20:59:59.999Z");
  assert.match(message, /08 Oct 2026/);
  assert.match(message, /23:59:59/);
  assert.match(message, /EAT$/);
});
