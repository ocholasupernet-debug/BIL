import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("src/routes/port-services-route.ts", "utf8");
const multiportUi = await readFile("../ochola-supernet/src/pages/admin/network/Multiport.tsx", "utf8");

test("in-flight port provisioning remains writable against older status constraints", () => {
  assert.match(route, /const persistedStatus = status === "provisioning" \? "pending" : status/);
  assert.match(route, /status: persistedStatus/);
});

test("Hotspot file removal uses an admin confirmation without a Super Admin-only gate", () => {
  assert.match(
    route,
    /hasHotspotFileMutationConfirmation\(req\.authUser,\s*req\.body\?\.portalFileRemovalConsent\)/,
  );
  assert.doesNotMatch(route, /hasSuperAdminHotspotFileConsent|superAdminConsent|without Super Admin approval/i);
  assert.match(multiportUi, /portalFileRemovalConsent:\s*removeHotspotFiles/);
  assert.match(multiportUi, /const removeHotspotFiles = window\.confirm/);
  assert.doesNotMatch(multiportUi, /isSuperAdmin|superAdminConsent|Super Admin approval/i);
});
