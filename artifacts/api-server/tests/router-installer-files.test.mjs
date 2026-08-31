import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scriptsRoute = await readFile("src/routes/scripts-route.ts", "utf8");
const httpsTrust = await readFile("src/lib/router-https-trust.ts", "utf8");
const pppoeRoute = await readFile("src/routes/pppoe-script-route.ts", "utf8");

test("installer selects an available storage directory, including router root", () => {
  assert.match(scriptsRoute, /:local storage ""/);
  assert.match(scriptsRoute, /name="disk1" type=directory/);
  assert.match(scriptsRoute, /name="flash" type=directory/);
  assert.match(scriptsRoute, /:local hsdir "hotspot"/);
  assert.match(scriptsRoute, /:set hsdir \(\$storage \. "\/hotspot"\)/);
  assert.match(scriptsRoute, /html-directory=\$hsdir/);
});

test("standalone hotspot child uses the same storage fallback and creates its directory", () => {
  const start = scriptsRoute.indexOf("const HOTSPOTSETUP_RSC");
  const end = scriptsRoute.indexOf("/* ── PPPoE setup", start);
  assert.ok(start >= 0 && end > start, "hotspot child source should be present");
  const hotspotSetup = scriptsRoute.slice(start, end);

  assert.match(hotspotSetup, /:local storage ""/);
  assert.match(hotspotSetup, /name="flash" type=directory/);
  assert.match(hotspotSetup, /:local hsdir "hotspot"/);
  assert.match(hotspotSetup, /\/file add name=\$hsdir type=directory/);
  assert.match(hotspotSetup, /html-directory=\$hsdir/);
});

test("installer verifies downloads and reports the resolved destination", () => {
  assert.match(scriptsRoute, /function verifyFetchedFile/);
  assert.match(scriptsRoute, /download did not create/);
  assert.match(scriptsRoute, /download destination is a directory/);
  assert.match(scriptsRoute, /download created an empty file/);
  assert.match(scriptsRoute, /keep-result=yes/);
  assert.match(scriptsRoute, /WARN: \$\{filename\} failed at/);
  assert.doesNotMatch(scriptsRoute, /portalFetch[\s\S]{0,500}dst-path=\(\$hsdir \. "/);
});

test("successful child imports preserve named RouterOS artifacts", () => {
  for (const fileName of [
    "hotspotsetup.rsc",
    "pppoesetup.rsc",
    "users.rsc",
    "syncusers.rsc",
    "heartbeat.rsc",
    "syncfull.rsc",
  ]) {
    assert.ok(
      scriptsRoute.includes(`/import "${fileName}.download"`),
      `${fileName} should import from a verified temporary file and retain its final name`,
    );
    assert.ok(
      scriptsRoute.includes(`name="${fileName}.download"] name="${fileName}"`),
      `${fileName} should be renamed into a visible Files entry`,
    );
  }

  assert.match(scriptsRoute, /name="failed-\$\{fileName\}"/);
  assert.doesNotMatch(scriptsRoute, /\/file remove (?:hotspotsetup|pppoesetup|users|syncusers|heartbeat|syncfull)\.rsc/);
});

test("portal files use explicit per-file paths and remain available after fetch", () => {
  assert.match(scriptsRoute, /const variableName = `portalPath/);
  assert.match(scriptsRoute, /dst-path=\$\$\{variableName\}/);
  assert.match(scriptsRoute, /verifyFetchedFile\(`\$\$\{variableName\}`, filename\)/);
  assert.doesNotMatch(scriptsRoute, /portalFetch[\s\S]{0,1000}\/file remove/);
});

test("coexistence hotspot uses a usable DHCP pool and preserves child diagnostics", () => {
  assert.ok(scriptsRoute.includes('const poolStart = gateway.replace(/\\.1$/, ".2");'));
  assert.ok(scriptsRoute.includes('const poolEnd = gateway.replace(/\\.1$/, ".254");'));
  assert.ok(!scriptsRoute.includes('gateway.replace(/\\\\.1$'));
  assert.match(scriptsRoute, /global ocholaCoexistenceError/);
  assert.match(scriptsRoute, /COEXISTENCE BUNDLE DOWNLOADED:/);
  assert.match(scriptsRoute, /after " \. \$coexistenceBundleBytes \. " bytes/);
  assert.match(scriptsRoute, /COEXISTENCE BUNDLE FAILED at/);
  assert.match(scriptsRoute, /isolated hotspot bundle import failed after .*bytes; inspect failed-ochola-coexistence-hotspot\.rsc.*failing stage/);
});

test("installer bootstraps the public CA and validates managed HTTPS fetches", () => {
  assert.match(scriptsRoute, /ISRG_ROOT_X1_PEM/);
  assert.match(httpsTrust, /ROUTER_HTTPS_CERTIFICATE_NAME = "ochola-isrg-root-x1"/);
  assert.match(httpsTrust, /-----BEGIN CERTIFICATE-----/);
  assert.match(scriptsRoute, /\/certificate import file-name="\$caFile" name="\$\{ROUTER_HTTPS_CERTIFICATE_NAME\}" trusted=yes/);
  assert.match(scriptsRoute, /ROUTER_HTTPS_FETCH_OPTIONS/);
  assert.match(scriptsRoute, /const ROUTER_HTTPS_FETCH_OPTIONS =\s+`mode=https check-certificate=yes`/);
  assert.doesNotMatch(scriptsRoute, /const ROUTER_HTTPS_FETCH_OPTIONS[\s\S]{0,120}certificate=\$\{ROUTER_HTTPS_CERTIFICATE_NAME\}/);

  const unverifiedFetches = scriptsRoute.match(/mode=https check-certificate=no/g) ?? [];
  assert.equal(
    unverifiedFetches.length,
    3,
    "only the one-time CA bootstrap and explicit hotspot/PPPoE fallback modes may skip certificate validation",
  );
  assert.match(scriptsRoute, /certificateMode === "unverified"/);
  assert.match(scriptsRoute, /req\.query\.certificate/);
});

test("PPPoE installers use the same verified HTTPS policy", () => {
  assert.match(pppoeRoute, /pppoeHttpsTrustBootstrap/);
  assert.match(pppoeRoute, /const ROUTER_HTTPS_FETCH_OPTIONS =\s+`mode=https check-certificate=yes`/);
  assert.doesNotMatch(pppoeRoute, /const ROUTER_HTTPS_FETCH_OPTIONS[\s\S]{0,120}certificate=\$\{ROUTER_HTTPS_CERTIFICATE_NAME\}/);

  const unverifiedFetches = pppoeRoute.match(/mode=https check-certificate=no/g) ?? [];
  assert.equal(unverifiedFetches.length, 1, "PPPoE bootstrap should be the only unverified fetch");
});