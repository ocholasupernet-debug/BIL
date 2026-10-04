import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(appRoot, "public/hotspot/login.html");
const outputPath = resolve(appRoot, "dist/public/hotspot/login.html");
const removedFallbackPath = resolve(appRoot, "dist/public/hotspot/error.html");

const [source, output] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(outputPath, "utf8"),
]);

assert.equal(
  output,
  source,
  "the build must copy the canonical interactive RouterOS login template directly to dist/public/hotspot/login.html",
);
assert.match(output, /function applyPortalConfig\(/);
assert.match(output, /function renderPlans\(/);

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