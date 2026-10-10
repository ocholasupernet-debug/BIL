import assert from "node:assert/strict";
import test from "node:test";
import { explainVpsDiskFailure } from "./storage-telemetry.js";

test("VPS disk telemetry failures expose only safe, actionable SSH categories", () => {
  const cases = [
    ["VPS command timed out after 15000ms.", "", /timed out.*SSH port 22/i],
    ["", "Permission denied (publickey).", /authentication failed/i],
    ["", "ssh: Could not resolve hostname example: Name or service not known", /hostname could not be resolved/i],
    ["", "connect to host 192.0.2.10 port 22: Connection refused", /refused the SSH connection/i],
    ["", "No route to host", /no network route/i],
    ["spawn ssh ENOENT", "", /does not have an SSH client/i],
    ["", "df: invalid option -- B", /filesystem usage command failed/i],
  ] as const;

  for (const [error, stderr, expected] of cases) {
    assert.match(explainVpsDiskFailure({ error, stderr }), expected);
  }
});

test("unrecognized VPS telemetry failures do not expose raw SSH diagnostics", () => {
  const message = explainVpsDiskFailure({
    error: "unexpected process failure",
    stderr: "sensitive-host user-specific output",
  });

  assert.match(message, /filesystem check failed over SSH/i);
  assert.doesNotMatch(message, /sensitive-host|user-specific/);
});
