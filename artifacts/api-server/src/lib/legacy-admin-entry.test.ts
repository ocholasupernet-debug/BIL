import assert from "node:assert/strict";
import test from "node:test";
import { resolveLegacyAdminEntry } from "./legacy-admin-entry.js";

test("routes the requested PHP-style URL to the tenant login role selector", () => {
  assert.equal(
    resolveLegacyAdminEntry(
      "ocholasupernet.isplatty.com",
      "/index.php?_route=admin/",
    ),
    "/admin/entry",
  );
  assert.equal(
    resolveLegacyAdminEntry(
      "ocholasupernet.isplatty.org",
      "/index.php?_route=admin/",
    ),
    "/admin/entry",
  );
});

test("does not treat the customer Hotspot hostname as an admin tenant host", () => {
  assert.equal(
    resolveLegacyAdminEntry("ocholasupernet.com", "/index.php?_route=admin/"),
    null,
  );
  assert.equal(
    resolveLegacyAdminEntry("admin.isplatty.com", "/index.php?_route=admin/"),
    null,
  );
});

test("only the exact PHP-style admin route is accepted", () => {
  for (const requestUrl of [
    "/index.php",
    "/index.php?_route=admin",
    "/index.php?_route=admin/dashboard",
    "/index.php?_route=admin/&_route=admin/",
    "/other.php?_route=admin/",
  ]) {
    assert.equal(
      resolveLegacyAdminEntry("ocholasupernet.isplatty.com", requestUrl),
      null,
      requestUrl,
    );
  }
});
