import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(appRoot, "public/hotspot/login.html");
const outputPath = resolve(appRoot, "dist/public/hotspot/login.html");
const reactSourcePath = resolve(appRoot, "src/pages/portal/HotspotLogin.tsx");
const refreshSourcePath = resolve(appRoot, "public/hotspot/rlogin.html");
const refreshOutputPath = resolve(appRoot, "dist/public/hotspot/rlogin.html");
const removedFallbackPath = resolve(appRoot, "dist/public/hotspot/error.html");

const [source, output, reactSource, refreshSource, refreshOutput] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(outputPath, "utf8"),
  readFile(reactSourcePath, "utf8"),
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
assert.match(output, /function formatPortalDataAllowance\(/);
assert.match(output, /function formatPortalSharedDevices\(/);
assert.match(output, /data_limit_mb/);
assert.match(output, /shared_users/);
assert.match(output, /Unlimited data/);
assert.match(output, /Limited ·/);
assert.doesNotMatch(
  output,
  /p\.validity\+'\s+'\+p\.unit\+' Unlimited/,
  "package cards must not label every plan as unlimited",
);
assert.match(output, /data-portal-layout="classic"/);
assert.match(output, /\/api\/public\/hotspot-branding/);
assert.match(
  output,
  /var targetHostname="ocholasupernet\.isplatty\.org"/,
  "Tawk.to must remain restricted to the exact OcholaSupernet hostname",
);
assert.match(
  output,
  /configuredApiBase\.protocol==="https:"/,
  "router-served pages must verify the tenant API origin over HTTPS",
);
assert.match(
  output,
  /pageHostname===targetHostname\|\|configuredTenantHostname===targetHostname/,
  "Tawk.to must recognize the exact tenant origin when RouterOS serves the page",
);
assert.match(
  output,
  /config&&config\.tawkEnabled===true/,
  "Tawk.to must remain opt-in through Hotspot Settings",
);
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
const builtInPackages = {};
for (const id of ["classic", "dansted-wifi"]) {
  const sourceDirectory = resolve(appRoot, "public/hotspot/layouts", id);
  const outputDirectory = resolve(appRoot, "dist/public/hotspot/layouts", id);
  const [manifestText, sourceLogin, outputLogin, sourceRlogin, outputRlogin, sourceMd5, outputMd5] = await Promise.all([
    readFile(resolve(sourceDirectory, "manifest.json"), "utf8"),
    readFile(resolve(sourceDirectory, "login.html"), "utf8"),
    readFile(resolve(outputDirectory, "login.html"), "utf8"),
    readFile(resolve(sourceDirectory, "rlogin.html"), "utf8"),
    readFile(resolve(outputDirectory, "rlogin.html"), "utf8"),
    readFile(resolve(sourceDirectory, "md5.js"), "utf8"),
    readFile(resolve(outputDirectory, "md5.js"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.id, id);
  assert.equal(manifest.entry, "login.html");
  assert.equal(manifest.handoff, "rlogin.html");
  assert.equal(manifest.independentFiles, true);
  assert.equal(outputLogin, sourceLogin, `${id} login package must ship unchanged`);
  assert.equal(outputRlogin, sourceRlogin, `${id} rlogin package must ship unchanged`);
  assert.equal(outputMd5, sourceMd5, `${id} helper must ship from its own package`);
  assert.match(outputLogin, new RegExp(`data-portal-layout="${id}"`));
  assert.match(outputLogin, new RegExp(`/hotspot/layouts/${id}/md5\\.js`));
  assert.doesNotMatch(outputLogin, /src=["']\/hotspot\/md5\.js["']/);
  for (const macro of ["$(link-login-only)", "$(chap-id)", "$(chap-challenge)", "$(link-status)", "$(error)"]) {
    assert.ok(outputLogin.includes(macro), `${id} login page must retain ${macro}`);
  }
  assert.match(outputRlogin, new RegExp(`data-bil-layout-package="${id}"`));
  builtInPackages[id] = { login: outputLogin, rlogin: outputRlogin, md5: outputMd5 };
}
assert.notEqual(builtInPackages.classic.login, builtInPackages["dansted-wifi"].login);
assert.notEqual(builtInPackages.classic.rlogin, builtInPackages["dansted-wifi"].rlogin);
assert.notEqual(builtInPackages.classic.md5, builtInPackages["dansted-wifi"].md5);
assert.match(
  output,
  /troubleshootConnection\(true\)/,
  "the connection-help page must attempt sign-in as soon as it opens",
);
assert.match(
  output,
  /Package active · sign-in pending/,
  "an active package must not be presented as a confirmed router session",
);
assert.match(
  output,
  /Retry sign-in/,
  "users must have a clear retry action when RouterOS does not confirm login",
);
assert.match(
  reactSource,
  /const handleTroubleshoot\s*=\s*async\s*\(\)\s*=>\s*\{[\s\S]*?const savedLogin = await signInWithSavedCredentials\(\);\s*if \(savedLogin\.activePlan && savedLogin\.retryable\) \{[\s\S]*?restartAutomaticReconnect\(\);[\s\S]*?\} else if \(!savedLogin\.signedIn && !savedLogin\.activePlan\) \{\s*const result = await requestHotspotTroubleshoot\("login"\)/,
  "connection help must retry active accounts and only fall back to purchase lookup when no active account was confirmed",
);
assert.match(
  reactSource,
  /const restartAutomaticReconnect = \(\) => \{\s*setAutoReconnectInProgress\(true\);\s*setManualReconnectRetryCycle\(cycle => cycle \+ 1\);\s*\};/,
  "a manual retry must restart the automatic reconnect loop",
);
assert.match(
  reactSource,
  /const lookupKey = `\$\{adminId\}:\$\{portalContext\.mac\}:\$\{manualReconnectRetryCycle\}`/,
  "a manual retry must create a new reconnect cycle for the current device",
);
assert.match(
  reactSource,
  /const runAutomaticReconnect\s*=\s*async\s*\(\)\s*=>\s*\{[\s\S]*?result\s*=\s*await requestHotspotTroubleshoot\("login"\);/,
  "the normal React hotspot sign-in page must automatically attempt login for this device",
);

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