import assert from "node:assert/strict";
import test from "node:test";
import {
  hasHotspotFileReplacementConsent,
  hasSuperAdminHotspotFileConsent,
} from "./hotspot-file-authorization.js";

test("only a Super Admin can explicitly approve approved Hotspot file replacement", () => {
  assert.equal(hasHotspotFileReplacementConsent({ type: "a", uid: "42" }, true), false);
  assert.equal(hasHotspotFileReplacementConsent({ type: "a", uid: "superadmin" }, true), true);
  assert.equal(hasHotspotFileReplacementConsent({ type: "a", uid: "42" }, false), false);
  assert.equal(
    hasHotspotFileReplacementConsent({
      type: "a",
      uid: "42",
      impersonationSessionId: "active-session",
    }, true),
    true,
  );
  assert.equal(hasHotspotFileReplacementConsent({ type: "c", uid: "42" }, true), false);
  assert.equal(hasHotspotFileReplacementConsent(undefined, true), false);
});

test("removing Hotspot files still requires explicit Super Admin consent", () => {
  assert.equal(
    hasSuperAdminHotspotFileConsent({ type: "a", uid: "superadmin" }, true),
    true,
  );
  assert.equal(
    hasSuperAdminHotspotFileConsent({ type: "a", uid: "superadmin" }, false),
    false,
  );
  assert.equal(
    hasSuperAdminHotspotFileConsent({
      type: "a",
      uid: "42",
      impersonationSessionId: "active-session",
    }, true),
    true,
  );
  assert.equal(hasSuperAdminHotspotFileConsent({ type: "a", uid: "42" }, true), false);
  assert.equal(hasSuperAdminHotspotFileConsent({ type: "c", uid: "42" }, true), false);
  assert.equal(hasSuperAdminHotspotFileConsent(undefined, true), false);
});