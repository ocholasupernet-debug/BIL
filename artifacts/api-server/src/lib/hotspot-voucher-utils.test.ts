import assert from "node:assert/strict";
import test from "node:test";
import {
  formatVoucherDuration,
  normalizeFixedHotspotVoucherCode,
  normalizeHotspotMac,
  normalizeKenyanVoucherPhone,
  normalizeRedeemableHotspotVoucherCode,
} from "./hotspot-voucher-utils.js";

test("fixed voucher codes are uppercase alphanumeric and at least three characters", () => {
  assert.equal(normalizeFixedHotspotVoucherCode("t6y"), "T6Y");
  assert.equal(normalizeFixedHotspotVoucherCode(" HYT46 "), "HYT46");
  assert.equal(normalizeFixedHotspotVoucherCode("T 6Y"), null);
  assert.equal(normalizeFixedHotspotVoucherCode("A1"), null);
  assert.equal(normalizeFixedHotspotVoucherCode("A".repeat(33)), null);
  assert.equal(normalizeFixedHotspotVoucherCode("T6-Y"), null);
});

test("redeemable voucher codes accept generated hyphen groups but never spaces", () => {
  assert.equal(normalizeRedeemableHotspotVoucherCode("t6y"), "T6Y");
  assert.equal(normalizeRedeemableHotspotVoucherCode("AB-CD34"), "AB-CD34");
  assert.equal(normalizeRedeemableHotspotVoucherCode("AB CD34"), null);
  assert.equal(normalizeRedeemableHotspotVoucherCode("AB--CD34"), null);
});

test("Kenyan voucher phones normalize both supported mobile ranges", () => {
  assert.equal(normalizeKenyanVoucherPhone("0712345678"), "254712345678");
  assert.equal(normalizeKenyanVoucherPhone("+254 112 345 678"), "254112345678");
  assert.equal(normalizeKenyanVoucherPhone("712345678"), "254712345678");
  assert.equal(normalizeKenyanVoucherPhone("0212345678"), null);
  assert.equal(normalizeKenyanVoucherPhone("abc0712345678"), null);
});

test("Hotspot MAC addresses normalize common RouterOS separators", () => {
  assert.equal(normalizeHotspotMac("fe:9f:05:d6:cf:de"), "FE:9F:05:D6:CF:DE");
  assert.equal(normalizeHotspotMac("FE-9F-05-D6-CF-DE"), "FE:9F:05:D6:CF:DE");
  assert.equal(normalizeHotspotMac("not-a-mac"), null);
});

test("voucher validity formats in the largest whole time unit", () => {
  assert.equal(formatVoucherDuration(1), "1 minute");
  assert.equal(formatVoucherDuration(180), "3 hours");
  assert.equal(formatVoucherDuration(1440), "1 day");
});
