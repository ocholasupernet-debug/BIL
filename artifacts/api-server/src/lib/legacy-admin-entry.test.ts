import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveCanonicalAdminLoginRedirect,
  resolveLegacyAdminEntry,
} from "./legacy-admin-entry.js";

test("routes the requested PHP-style URL directly to the tenant admin login", () => {
  assert.equal(
    resolveLegacyAdminEntry(
      "ocholasupernet.isplatty.com",
      "/index.php?_route=admin/",
    ),
    "/admin/login",
  );
  assert.equal(
    resolveLegacyAdminEntry(
      "ocholasupernet.isplatty.org",
      "/index.php?_route=admin/",
    ),
    "/admin/login",
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

test("canonicalizes tenant admin login URLs to the PHP-style entry", () => {
  assert.equal(
    resolveCanonicalAdminLoginRedirect("ocholasupernet.isplatty.com", "/admin/login"),
    "/index.php?_route=admin/",
  );
  assert.equal(
    resolveCanonicalAdminLoginRedirect(
      "ocholasupernet.isplatty.com",
      "/admin/login?first_login=1&subdomain=ocholasupernet&_route=wrong",
    ),
    "/index.php?_route=admin/&first_login=1&subdomain=ocholasupernet",
  );
});

test("does not canonicalize Hotspot, platform, or unrelated login routes", () => {
  assert.equal(resolveCanonicalAdminLoginRedirect("ocholasupernet.com", "/admin/login"), null);
  assert.equal(resolveCanonicalAdminLoginRedirect("admin.isplatty.com", "/admin/login"), null);
  assert.equal(
    resolveCanonicalAdminLoginRedirect("ocholasupernet.isplatty.com", "/admin/login/isp"),
    null,
  );
});
