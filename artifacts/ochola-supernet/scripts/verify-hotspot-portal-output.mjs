import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(appRoot, "public/hotspot/login.html");
const outputPath = resolve(appRoot, "dist/public/hotspot/login.html");
const refreshSourcePath = resolve(appRoot, "public/hotspot/rlogin.html");
const refreshOutputPath = resolve(appRoot, "dist/public/hotspot/rlogin.html");
const removedFallbackPath = resolve(appRoot, "dist/public/hotspot/error.html");

const [source, output, refreshSource, refreshOutput] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(outputPath, "utf8"),
  readFile(refreshSourcePath, "utf8"),
  readFile(refreshOutputPath, "utf8"),
]);

assert.equal(
  output,
  source,
  "the build must copy the canonical interactive RouterOS login template directly to dist/public/hotspot/login.html",
);
assert.match(output, /function applyPortalConfig\(/);
assert.match(output, /function renderPlans\(/);
assert.match(output, /data-portal-layout="classic"/);
assert.match(output, /\/api\/public\/hotspot-branding/);
assert.doesNotMatch(
  output,
  /function applyPortalLayout\s*\(|applyPortalLayout\s*\(|data\.portalLayout|hotspot-portal-layout-runtime|\/hotspot\/portal-layouts\.css/,
  "the shared RouterOS login must not switch layouts after an asynchronous branding request",
);
assert.equal(
  refreshOutput,
  refreshSource,
  "the build must copy the RouterOS refresh handoff directly to dist/public/hotspot/rlogin.html",
);
assert.match(refreshOutput, /http-equiv="refresh"\s+content="0;url=\$\(link-login-only\)"/i);
assert.match(refreshOutput, /<body[^>]*\bhidden\b/i);

try {
  await access(removedFallbackPath, constants.F_OK);
  throw new Error("the build must not include the removed static hotspot error page");
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    // Expected: no standalone fallback error page is shipped.
  } else {
    throw error;
  }
}

console.log("Verified canonical interactive Hotspot login.html build output.");