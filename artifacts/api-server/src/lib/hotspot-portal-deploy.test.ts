import assert from "node:assert/strict";
import { test } from "node:test";
import { validateGeneratedHotspotPortal } from "./hotspot-portal-deploy";

function html(config: Record<string, unknown> = { apiBase: "https://tenant.isplatty.org" }): string {
  return [
    "<!doctype html><html><head>",
    `<script>window.__HOTSPOT_CONFIG__=${JSON.stringify(config)};</script>`,
    "</head><body>",
    "$(link-login-only) $(link-orig) $(if error) $(endif error)",
    "</body></html>",
  ].join("");
}

test("accepts a complete generated portal with a public HTTPS API origin", () => {
  const result = validateGeneratedHotspotPortal(html());
  assert.ok("content" in result);
  assert.equal(result.content.toString("utf8"), html());
});

test("rejects a portal missing RouterOS markers or generated configuration", () => {
  const missingMacro = validateGeneratedHotspotPortal(html().replace("$(link-orig)", ""));
  assert.deepEqual(missingMacro, {
    error: "Generated portal HTML is missing RouterOS marker $(link-orig).",
  });
  const missingConfig = validateGeneratedHotspotPortal(
    "<!doctype html><html>$(link-login-only) $(link-orig) $(if error) $(endif error)</html>",
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