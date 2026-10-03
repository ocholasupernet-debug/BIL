import assert from "node:assert/strict";
import test from "node:test";
import { hasSuperAdminHotspotFileConsent } from "./hotspot-file-authorization.js";

test("approved hotspot replacements require an explicit consent flag", () => {
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
});

test("tenant administrators and customer tokens cannot approve hotspot replacement", () => {
  assert.equal(hasSuperAdminHotspotFileConsent({ type: "a", uid: "42" }, true), false);
  assert.equal(hasSuperAdminHotspotFileConsent({ type: "c", uid: "42" }, true), false);
  assert.equal(hasSuperAdminHotspotFileConsent(undefined, true), false);
});