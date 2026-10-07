import assert from "node:assert/strict";
import test from "node:test";
import { preserveCumulativeUsage } from "./prepaid-usage";

test("routine lower session observations cannot reduce stored cumulative usage", () => {
  assert.equal(preserveCumulativeUsage(300, 900, 0), 900);
  assert.equal(preserveCumulativeUsage(300, "900", 0), 900);
  assert.equal(preserveCumulativeUsage(0, 50_000_000, 0), 50_000_000);
});

test("cumulative usage falls back to the stored megabyte value", () => {
  assert.equal(preserveCumulativeUsage(300, null, 2), 2_000_000);
  assert.equal(preserveCumulativeUsage(300, undefined, undefined), 300);
});

test("invalid and negative usage observations are clamped safely", () => {
  assert.equal(preserveCumulativeUsage(Number.NaN, -1, -2), 0);
  assert.equal(preserveCumulativeUsage(-4, "bad", 1.5), 1_500_000);
});