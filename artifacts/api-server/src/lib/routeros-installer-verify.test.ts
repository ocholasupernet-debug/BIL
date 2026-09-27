import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const verifierScript = await readFile(
  new URL("../../../../mikrotik-installer-verify.rsc", import.meta.url),
  "utf8",
);

test("installer verifier only parses the WireGuard command on RouterOS 7", () => {
  assert.match(verifierScript, /:local routerOsVersion \[\/system resource get version\]/);
  assert.match(verifierScript, /:local routerOsMajor \[:pick \$routerOsVersion 0 1\]/);
  const wireGuardBranchStart = verifierScript.indexOf(':if ($routerOsMajor = "7") do={');
  const wireGuardBranchEnd = verifierScript.indexOf(':local ipsecFound', wireGuardBranchStart);
  assert.ok(wireGuardBranchStart >= 0 && wireGuardBranchEnd > wireGuardBranchStart);
  const wireGuardBranch = verifierScript.slice(wireGuardBranchStart, wireGuardBranchEnd);
  assert.match(wireGuardBranch, /:parse .*\/interface wireguard find where name~/);
  assert.match(wireGuardBranch, /\$wireGuardProbe/);
  assert.match(verifierScript, /WireGuard check skipped; WireGuard is not available in RouterOS 6/);
  assert.doesNotMatch(
    verifierScript,
    /^:local wireGuardFound \(.*\/interface wireguard find/m,
  );
});