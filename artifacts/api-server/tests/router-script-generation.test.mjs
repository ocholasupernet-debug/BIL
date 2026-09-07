import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMainhotspotRsc,
  validateGeneratedRouterScript,
} from "../src/routes/scripts-route.ts";

test("rendered mainhotspot.rsc keeps RouterOS encoder escapes on one line", () => {
  const script = buildMainhotspotRsc(
    "https://come.isplatty.org/api/scripts",
    "https://come.isplatty.org/api/isp/router/install-progress/90?token=example",
    "come1",
    "Ochola SuperNet",
  );

  assert.equal(script.includes("\r"), false);
  assert.equal(/[^\x00-\x7F]/.test(script), false);
  assert.match(script, /:global ocholaFormEncode do=\{[\s\S]*\\r/);
  assert.match(script, /:local formEncode do=\{[\s\S]*\\n/);
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