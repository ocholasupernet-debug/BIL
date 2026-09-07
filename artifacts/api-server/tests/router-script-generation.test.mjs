import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMainhotspotRsc,
  validateGeneratedRouterScript,
} from "../src/routes/scripts-route.ts";
import { buildMainIspConfigurationRsc } from "../src/routes/isp-configuration-route.ts";

test("rendered mainhotspot.rsc keeps RouterOS encoder escapes on one line", () => {
  const script = buildMainhotspotRsc(
    "https://come.isplatty.org/api/scripts",
    "https://come.isplatty.org/api/isp/router/install-progress/90?token=example",
    "come1",
    "Ochola SuperNet",
  );

  assert.equal(script.includes("\r"), false);
  assert.equal(/[^\x00-\x7F]/.test(script), false);
  assert.equal((script.match(/:global ocholaFormEncode do=\{/g) ?? []).length, 1);
  assert.match(script, /:global ocholaFormEncode do=\{\s*:return \[:tostr \$1\]\s*\}/);
  const encoderStart = script.indexOf(":global ocholaFormEncode do={");
  const encoderEnd = script.indexOf("\n\n", encoderStart);
  const encoder = script.slice(encoderStart, encoderEnd);
  assert.doesNotMatch(encoder, /:local formEncode do=\{|\\r|\\n|\$char|\$output/);
  assert.doesNotMatch(script, /\$char = "\r"/);
  assert.doesNotMatch(script, /\$char = "\n"/);
  assert.doesNotMatch(script, /Unsupported RouterOS version ""/);
  assert.match(
    script,
    /Unsupported RouterOS version " \. \$routerOsVersion \. "\. Only RouterOS 6\.48\+/,
  );

  for (const [lineNumber, line] of script.split("\n").entries()) {
    assert.equal(line.includes("\r"), false, `line ${lineNumber + 1} contains CR`);
  }
});

test("core installer omits progress code when no progress endpoint is supplied", () => {
  const script = buildMainhotspotRsc(
    "https://come.isplatty.org/api/scripts",
    "",
    "come1",
    "Ochola SuperNet",
  );

  assert.doesNotMatch(script, /ocholaFormEncode|IPProgUrl|\$pg/);
  assert.equal(/[^\x00-\x7F]/.test(script), false);
  assert.equal(validateGeneratedRouterScript(script), script);
});

test("coexistence installer uses the same flat progress function", () => {
  const script = buildMainhotspotRsc(
    "https://come.isplatty.org/api/scripts",
    "https://come.isplatty.org/api/isp/router/install-progress/90?token=example",
    "come1",
    "Ochola SuperNet",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "ochola-mgmt-vpn-90",
    "",
    "verified",
    "coexist",
    "https://come.isplatty.org/api/scripts/coexistence-hotspot.rsc",
  );

  assert.equal((script.match(/:global ocholaFormEncode do=\{/g) ?? []).length, 1);
  assert.doesNotMatch(script, /:local formEncode do=\{|\$char|\$output/);
  assert.equal((script.match(/# Stage [1-7]/g) ?? []).length, 7);
  assert.match(script, /:local errors ""/);
  assert.match(script, /COEXISTENCE INSTALLATION SUMMARY/);
  assert.match(script, /SUCCESS: management VPN/);
  assert.match(script, /FAILED: management VPN/);
  assert.match(script, /ERRORS: /);
  assert.doesNotMatch(script, /COEXISTENCE STOPPED|Coexistence stopped without changing/);
  assert.match(script, /WARN: progress callback failed; continuing installer/);
  assert.equal(validateGeneratedRouterScript(script), script);
});

test("rendered script validation rejects a physical newline inside RouterOS quotes", () => {
  assert.throws(
    () => validateGeneratedRouterScript(':put "first\nsecond"\n'),
    /line break inside a quoted string/,
  );
  assert.equal(
    validateGeneratedRouterScript(':put "first\\\\nsecond"\n'),
    ':put "first\\\\nsecond"\n',
  );
});

test("router-scoped Main ISP installer validates the actual public route output", () => {
  const script = buildMainIspConfigurationRsc(
    "come",
    "come1",
    "https://come.isplatty.org/scripts/router-vpn-bootstrap/90/Abcdefghijklmno_1234567890",
    90,
  );

  assert.equal(/[^\x00-\x7F]/.test(script), false);
  assert.match(script, /:if \(\[\/ping address=\$internetTarget count=2\] > 0\)/);
  assert.doesNotMatch(script, /\[\/ping \$internetTarget count=2\]/);
  assert.equal(validateGeneratedRouterScript(script), script);
});

test("Self Install coexistence uses a RouterOS 6-safe CA fallback argument", () => {
  const script = buildMainhotspotRsc(
    "https://come.isplatty.org/api/scripts",
    "https://come.isplatty.org/api/isp/router/install-progress/90?token=example",
    "come1",
    "Ochola SuperNet",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "ochola-mgmt-vpn-90",
    "",
    "verified",
    "coexist",
    "https://come.isplatty.org/api/scripts/coexistence-hotspot.rsc",
  );
  const caFallbackLine = script.split("\n").find((line) => line.includes("/file add name=$caFile contents=")) ?? "";

  assert.match(caFallbackLine, /\/file add name=\$caFile contents=/);
  assert.doesNotMatch(caFallbackLine, /name="\$caFile"/);
  assert.equal(validateGeneratedRouterScript(script), script);
});