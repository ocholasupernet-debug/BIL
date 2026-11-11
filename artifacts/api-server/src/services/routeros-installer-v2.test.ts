import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ROUTEROS_INSTALLER_V2_APPLY_ENABLED,
  ROUTEROS_INSTALLER_V2_POOL_PLAN,
  ROUTEROS_INSTALLER_V2_VERSION,
  buildInstallerV2PreflightScript,
  buildInstallerV2EntryUrl,
  parseSupportedRouterOsRelease,
  validateInstallerV2PublicOrigin,
} from "./routeros-installer-v2.js";

const installerRouteSource = readFileSync(
  new URL("../routes/routeros-installer-v2-route.ts", import.meta.url),
  "utf8",
);

test("installer commands use the tenant host without issuing an enrollment token", () => {
  assert.match(installerRouteSource, /buildInstallerV2EntryUrl\(process\.env\.PUBLIC_APP_ORIGIN,\s*admins\[0\]\?\.subdomain\)/);
  assert.match(installerRouteSource, /const entryUrl = origin;/);
  assert.match(installerRouteSource, /routerosInstallerV2PublicRouter\.get\("\/scripts\/v2\/mainhotspot\.rsc"/);
  assert.doesNotMatch(installerRouteSource, /randomBytes|req\.query\.token|token_hash/);
});

test("v2 only accepts RouterOS 6.48+ and RouterOS 7 releases", () => {
  assert.equal(parseSupportedRouterOsRelease("6.47.10"), null);
  assert.deepEqual(parseSupportedRouterOsRelease("6.48.7"), {
    major: 6, minor: 48, patch: 7, raw: "6.48.7",
  });
  assert.deepEqual(parseSupportedRouterOsRelease("7.16.2"), {
    major: 7, minor: 16, patch: 2, raw: "7.16.2",
  });
  assert.deepEqual(parseSupportedRouterOsRelease("7.16.2 (stable)"), {
    major: 7, minor: 16, patch: 2, raw: "7.16.2 (stable)",
  });
  assert.equal(parseSupportedRouterOsRelease("RouterOS 7.16"), null);
});

test("requested PPPoE ranges are split into valid non-network/non-broadcast subranges", () => {
  assert.deepEqual(ROUTEROS_INSTALLER_V2_POOL_PLAN.active, [
    "192.168.185.5-192.168.185.254",
    "192.168.186.1-192.168.186.254",
    "192.168.187.1-192.168.187.254",
  ]);
  assert.deepEqual(ROUTEROS_INSTALLER_V2_POOL_PLAN.expired, [
    "192.168.188.5-192.168.188.254",
    "192.168.189.1-192.168.189.254",
    "192.168.190.1-192.168.190.254",
  ]);
  for (const range of [...ROUTEROS_INSTALLER_V2_POOL_PLAN.active, ...ROUTEROS_INSTALLER_V2_POOL_PLAN.expired]) {
    assert.doesNotMatch(range, /\.0(?:-|$)|\.255(?:-|$)/);
  }
});

test("v2 entry URL requires an explicit valid HTTPS origin and uses only the separate v2 path", () => {
  assert.equal(buildInstallerV2EntryUrl(undefined), null);
  assert.equal(buildInstallerV2EntryUrl("http://ocholasupernet.isplatty.com"), null);
  assert.equal(buildInstallerV2EntryUrl("https://user:pass@host.example"), null);
  assert.equal(
    buildInstallerV2EntryUrl("https://ocholasupernet.isplatty.com/"),
    "https://ocholasupernet.isplatty.com/scripts/v2/mainhotspot.rsc",
  );
  assert.equal(
    buildInstallerV2EntryUrl("https://isplatty.org"),
    "https://isplatty.org/scripts/v2/mainhotspot.rsc",
  );
  assert.equal(
    buildInstallerV2EntryUrl("https://isplatty.com", "customer-net"),
    "https://customer-net.isplatty.com/scripts/v2/mainhotspot.rsc",
  );
  assert.equal(buildInstallerV2EntryUrl("https://isplatty.com", "bad/name"), null);
  assert.equal(buildInstallerV2EntryUrl("https://isplatty.com", "admin"), null);
  assert.equal(
    validateInstallerV2PublicOrigin("https://host.example/path"),
    null,
  );
});

test("v2 remains non-applying until the same-address design is device-validated", () => {
  assert.equal(ROUTEROS_INSTALLER_V2_VERSION, "2.0.0");
  assert.equal(ROUTEROS_INSTALLER_V2_APPLY_ENABLED, false);
});

test("preflight script backs up and inventories without applying network changes or exposing credentials", () => {
  const script = buildInstallerV2PreflightScript();
  assert.match(script, /OCHOLASUPERNET RouterOS installer/);
  assert.doesNotMatch(script, /\bBIL\b|bil-v2-preflight/);
  assert.match(script, /PRE-FLIGHT ONLY/);
  assert.match(script, /RouterOS 6\.48 or later/);
  assert.match(script, /\/system backup save/);
  assert.match(script, /\/export file=/);
  assert.match(script, /DISCOVERY: interfaces/);
  assert.match(script, /credential detail is intentionally not printed/);
  assert.match(script, /apply gate is closed/);
  assert.doesNotMatch(script, /password=|private-key=|secret=/i);
  assert.doesNotMatch(script, /\/ip address add|\/interface bridge add|\/ip hotspot add|\/ppp profile add/i);
});
