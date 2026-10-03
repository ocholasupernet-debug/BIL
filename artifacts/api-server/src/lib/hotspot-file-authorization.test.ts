import assert from "node:assert/strict";
import test from "node:test";
import { hasHotspotFileMutationConfirmation } from "./hotspot-file-authorization.js";

test("any authorized admin can explicitly confirm a Hotspot file change", () => {
  assert.equal(hasHotspotFileMutationConfirmation({ type: "a", uid: "42" }, true), true);
  assert.equal(hasHotspotFileMutationConfirmation({ type: "a", uid: "superadmin" }, true), true);
  assert.equal(
    hasHotspotFileMutationConfirmation({
      type: "a",
      uid: "42",
      impersonationSessionId: "active-session",
    }, true),
    true,
  );
  assert.equal(hasHotspotFileMutationConfirmation({ type: "a", uid: "42" }, false), false);
  assert.equal(hasHotspotFileMutationConfirmation({ type: "c", uid: "42" }, true), false);
  assert.equal(hasHotspotFileMutationConfirmation(undefined, true), false);
});
