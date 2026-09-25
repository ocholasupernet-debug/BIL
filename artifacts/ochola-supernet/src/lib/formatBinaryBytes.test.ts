import assert from "node:assert/strict";
import test from "node:test";
import { formatBinaryBytes } from "./formatBinaryBytes";

test("formats byte counts consistently from bytes through petabytes", () => {
  assert.equal(formatBinaryBytes(0), "0 B");
  assert.equal(formatBinaryBytes(1023), "1023 B");
  assert.equal(formatBinaryBytes(1024), "1.00 KB");
  assert.equal(formatBinaryBytes(39 * 1024 ** 3 + 3 * 1024 ** 3 / 16), "39.19 GB");
  assert.equal(formatBinaryBytes(1_596_380_140_890), "1.45 TB");
  assert.equal(formatBinaryBytes(1024 ** 5), "1.00 PB");
});

test("accepts numeric API strings without leaking raw or invalid values", () => {
  assert.equal(formatBinaryBytes("1073741824"), "1.00 GB");
  for (const value of [null, undefined, "", "n/a", -1, Number.POSITIVE_INFINITY]) {
    assert.equal(formatBinaryBytes(value), "—");
  }
});