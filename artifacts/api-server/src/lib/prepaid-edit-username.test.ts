import assert from "node:assert/strict";
import test from "node:test";
import { prepaidHotspotUsernameForEdit } from "./prepaid-identifiers.js";

test("ordinary prepaid edits keep the existing hotspot login", () => {
  assert.equal(
    prepaidHotspotUsernameForEdit("254712345678-AB:12", "0712345678", "254712345678"),
    "254712345678-AB:12",
  );
});

test("changing contact phone keeps the original suffix without randomizing the login", () => {
  assert.equal(
    prepaidHotspotUsernameForEdit("254712345678-AB:12", "0712345678", "0799999999"),
    "254799999999-AB:12",
  );
});

test("a legacy login stays unchanged on a name-only edit", () => {
  assert.equal(
    prepaidHotspotUsernameForEdit("legacy-user", "0712345678", "0712345678"),
    "legacy-user",
  );
});

test("a missing phone cannot create a new hotspot login", () => {
  assert.equal(prepaidHotspotUsernameForEdit("legacy-user", null, null), "");
});