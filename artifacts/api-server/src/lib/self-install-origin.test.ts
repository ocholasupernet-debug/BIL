import test from "node:test";
import assert from "node:assert/strict";
import { buildSelfInstallTenantOrigin, moveSelfInstallHostnameToCom } from "./self-install-origin.js";

test("Self Install tenant source is canonicalized to the assigned isplatty.com hostname", () => {
  assert.equal(buildSelfInstallTenantOrigin("ocholasupernet"), "https://ocholasupernet.isplatty.com");
  assert.equal(buildSelfInstallTenantOrigin("bad/name"), null);
  assert.equal(buildSelfInstallTenantOrigin("admin"), null);
  assert.equal(buildSelfInstallTenantOrigin("come"), null);
});

test("Self Install rewrites only owned isplatty.org portal names to .com", () => {
  assert.equal(moveSelfInstallHostnameToCom("come.isplatty.org"), "come.isplatty.com");
  assert.equal(moveSelfInstallHostnameToCom("isplatty.org"), "isplatty.com");
  assert.equal(moveSelfInstallHostnameToCom("portal.example.net"), "portal.example.net");
});
