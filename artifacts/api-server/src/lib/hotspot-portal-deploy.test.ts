import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateGeneratedHotspotHandoff,
  validateIndependentHotspotLogin,
  validateGeneratedHotspotPortal,
} from "./hotspot-portal-deploy.js";

function html(config: Record<string, unknown> = { apiBase: "https://tenant.isplatty.org" }): string {
  return [
    "<!doctype html><html><head>",
    `<script>window.__HOTSPOT_CONFIG__=${JSON.stringify(config)};</script>`,
    "</head><body>",
    "$(link-login-only) $(link-orig) $(if error) $(endif)",
    "</body></html>",
  ].join("");
}

test("accepts a complete generated portal with a public HTTPS API origin", () => {
  const result = validateGeneratedHotspotPortal(html());
  assert.ok("content" in result);
  assert.equal(result.content.toString("utf8"), html());
});

test("accepts generated configuration followed by layout bootstrap code", () => {
  const generated = html({
    apiBase: "https://tenant.isplatty.org",
    portalLayout: "split",
    tenantMessage: "The characters }; inside text are not the end of the config.",
  }).replace(
    "</script>",
    'document.documentElement.setAttribute("data-portal-layout",window.__HOTSPOT_CONFIG__.portalLayout);</script>',
  );

  const result = validateGeneratedHotspotPortal(generated);
  assert.ok("content" in result);
  assert.equal(result.content.toString("utf8"), generated);
});

test("rejects a portal missing RouterOS markers or generated configuration", () => {
  const missingMacro = validateGeneratedHotspotPortal(html().replace("$(link-orig)", ""));
  assert.deepEqual(missingMacro, {
    error: "Generated portal HTML is missing RouterOS marker $(link-orig).",
  });
  const missingConfig = validateGeneratedHotspotPortal(
    "<!doctype html><html>$(link-login-only) $(link-orig) $(if error) $(endif)</html>",
  );
  assert.deepEqual(missingConfig, {
    error: "Generated portal HTML is missing its portal configuration.",
  });
});

test("rejects internal or non-HTTPS API origins", () => {
  for (const apiBase of ["http://tenant.isplatty.org", "https://localhost:8080", "https://127.0.0.1:8080"]) {
    const result = validateGeneratedHotspotPortal(html({ apiBase }));
    assert.deepEqual(result, {
      error: "Generated portal configuration must use a public HTTPS API origin.",
    });
  }
});

test("rejects restricted credentials in config or markup", () => {
  const configSecret = validateGeneratedHotspotPortal(html({
    apiBase: "https://tenant.isplatty.org",
    routerSecret: "not-for-export",
  }));
  assert.deepEqual(configSecret, {
    error: "Generated portal configuration contains restricted credentials.",
  });

  const markupSecret = validateGeneratedHotspotPortal(
    html().replace("</body>", "router_secret=not-for-export</body>"),
  );
  assert.deepEqual(markupSecret, {
    error: "Generated portal HTML contains restricted credential material.",
  });
});

test("rejects oversized and non-HTML uploads", () => {
  assert.deepEqual(validateGeneratedHotspotPortal("not html"), {
    error: "Generated portal HTML must be a complete HTML document.",
  });
  const oversized = `<!doctype html>${"x".repeat(2_500_001)}`;
  assert.deepEqual(validateGeneratedHotspotPortal(oversized), {
    error: "Generated portal HTML is too large.",
  });
});

test("validates independent Classic and Dansted rlogin files", () => {
  const classic = '<!doctype html><html data-bil-layout-package="classic"><body>$(link-login-only)</body></html>';
  const dansted = '<!doctype html><html data-bil-layout-package="dansted-wifi"><body>$(link-login-only)</body></html>';
  assert.ok("content" in validateGeneratedHotspotHandoff(classic, "classic"));
  assert.ok("content" in validateGeneratedHotspotHandoff(dansted, "dansted-wifi"));
  assert.deepEqual(validateGeneratedHotspotHandoff(classic, "dansted-wifi"), {
    error: "The rlogin page does not belong to the selected dansted-wifi layout.",
  });
  assert.deepEqual(validateGeneratedHotspotHandoff("<!doctype html><html></html>", "classic"), {
    error: "The rlogin page is missing the RouterOS login destination.",
  });
});

test("requires each independent login page to use its own package and helper", () => {
  const classic = '<html data-portal-layout="classic"><script src="/hotspot/layouts/classic/md5.js"></script></html>';
  const dansted = '<html data-portal-layout="dansted-wifi"><script src="/hotspot/layouts/dansted-wifi/md5.js"></script></html>';

  assert.deepEqual(validateIndependentHotspotLogin(classic, "classic"), { ok: true });
  assert.deepEqual(validateIndependentHotspotLogin(dansted, "dansted-wifi"), { ok: true });
  const wrongLayout = validateIndependentHotspotLogin(dansted, "classic");
  assert.ok("error" in wrongLayout);
  assert.match(wrongLayout.error, /does not belong/);
  const sharedHelper = validateIndependentHotspotLogin(
    '<html data-portal-layout="classic"><script src="/hotspot/md5.js"></script></html>',
    "classic",
  );
  assert.ok("error" in sharedHelper);
  assert.match(sharedHelper.error, /own classic helper/);
});