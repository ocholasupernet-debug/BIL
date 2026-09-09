import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMainhotspotRsc,
  getDeployableSource,
  listDeployableSources,
  validateGeneratedRouterScript,
} from "../src/routes/scripts-route.ts";
import { buildMainIspConfigurationRsc } from "../src/routes/isp-configuration-route.ts";
import { buildManagementApiRepairScript } from "../src/lib/router-management-repair.ts";

test("approved deployment catalog includes the management firewall config", () => {
  const sources = listDeployableSources();
  const firewall = sources.find(source => source.type === "script" && source.name === "management-firewall.rsc");
  assert.ok(firewall);

  const content = getDeployableSource("script", "management-firewall.rsc")?.content.toString("utf8") ?? "";
  assert.match(content, /10\.8\.5\.0\/24/);
  assert.match(content, /10\.8\.6\.0\/24/);
  assert.match(content, /dst-port=8728,8729/);
  assert.match(content, /DO NOT DELETE - OcholaSupernet management API/);
  assert.doesNotMatch(content, /\/ip firewall filter remove|\/ip firewall nat remove/);
});

test("approved hotspot access config includes customer NAT, forwarding, and portal sign-in rules", () => {
  const sources = listDeployableSources();
  assert.ok(sources.some(source => source.type === "script" && source.name === "hotspot-access.rsc"));

  const content = getDeployableSource("script", "hotspot-access.rsc")?.content.toString("utf8") ?? "";
  assert.match(content, /action=masquerade/);
  assert.match(content, /192\.168\.88\.0\/24/);
  assert.match(content, /192\.168\.99\.0\/24/);
  assert.match(content, /ochola-hotspot-dhcp/);
  assert.match(content, /dns-server="192\.168\.88\.1"/);
  assert.match(content, /OcholaSuperNet - hotspot internet/);
  assert.match(content, /OcholaSuperNet - PPPoE internet/);
  assert.match(content, /dst-host=\$hostname/);
  assert.match(content, /login-by=http-chap,http-pap,cookie/);
  assert.match(content, /OcholaSuperNet - captive portal/);
  assert.doesNotMatch(content, /\/ip firewall filter remove \[find\]|\/ip firewall nat remove \[find\]/);
});

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

test("phased management repair script is clean and idempotent", () => {
  const script = buildManagementApiRepairScript({
    routerName: "come1",
    routerPassword: 'secret$with"quotes',
    phase: "all",
  });

  assert.equal(validateGeneratedRouterScript(script), script);
  assert.match(script, /OCHOLASUPERNET_PHASE=preflight/);
  assert.match(script, /OCHOLASUPERNET_PHASE=identity/);
  assert.match(script, /OCHOLASUPERNET_PHASE=api/);
  assert.match(script, /OCHOLASUPERNET_PHASE=firewall/);
  assert.match(script, /OCHOLASUPERNET_PHASE=verify/);
  assert.match(script, /name="ocholasupernet"/);
  assert.match(script, /group=full/);
  assert.match(script, /address=""/);
  assert.match(script, /FAILED_COMPONENT=user-policy/);
  assert.match(script, /FAILED_COMPONENT=user-address/);
  assert.match(script, /10\.8\.5\.0\/24,10\.8\.6\.0\/24/);
  assert.match(script, /DO NOT DELETE - OcholaSupernet management API/);
  assert.match(script, /secret\\\$with\\"quotes/);
  assert.doesNotMatch(script, /\/user remove|\/ip service remove|\/ip firewall filter remove/);
  assert.doesNotMatch(script, /OCHOLASUPERNET_STATUS=SUCCESS.*OCHOLASUPERNET_STATUS=FAILED/s);
});

test("each management repair phase can be generated independently", () => {
  for (const phase of ["preflight", "identity", "api", "firewall", "verify"]) {
    const script = buildManagementApiRepairScript({
      routerName: "come1",
      routerPassword: "router-secret",
      phase,
    });
    assert.equal(validateGeneratedRouterScript(script), script);
    assert.match(script, new RegExp(`OCHOLASUPERNET_PHASE=${phase}`));
    assert.equal(
      ["preflight", "identity", "api", "firewall", "verify"]
        .filter(other => script.includes(`OCHOLASUPERNET_PHASE=${other}`)).length,
      1,
    );
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
  assert.match(script, /\/file print file=\$caBuildBase/);
  assert.match(script, /\/file set \[find name=\$caBuildFile\] contents=\$caText/);
  assert.match(script, /:set caText \(\$caText \. "\\n" \./);
  assert.doesNotMatch(script, /\/file add name=\$caFile contents=/);
  assert.doesNotMatch(script, /\\r\\n/);
  assert.equal(validateGeneratedRouterScript(script), script);
});

test("coexistence VPN children use versioned path bootstrap URLs", () => {
  const script = buildMainhotspotRsc(
    "https://come.isplatty.org/api/scripts",
    "",
    "come1",
    "Ochola SuperNet",
    "",
    "",
    "",
    "https://come.isplatty.org/api/scripts/router-vpn-bootstrap/90/Abcdefghijklmno_1234567890",
    "https://come.isplatty.org/api/scripts/router-vpn-bootstrap/90/Abcdefghijklmno_1234567890/openvpn-backup",
    "",
    "",
    "10.8.5.90",
    "ochola-mgmt-vpn-90",
    "",
    "verified",
    "coexist",
  );

  assert.match(
    script,
    /:if \(\$majorVersion = 7\) do=\{ :set openVpnUrl "https:\/\/come\.isplatty\.org\/api\/scripts\/router-vpn-bootstrap\/90\/Abcdefghijklmno_1234567890\/7\.rsc" \} else=\{ :set openVpnUrl "https:\/\/come\.isplatty\.org\/api\/scripts\/router-vpn-bootstrap\/90\/Abcdefghijklmno_1234567890\/6\.rsc" \}/,
  );
  assert.match(
    script,
    /Abcdefghijklmno_1234567890\/7\/openvpn-backup\.rsc/,
  );
  assert.doesNotMatch(script, /router-vpn-bootstrap\/90\/Abcdefghijklmno_1234567890[^\n]*&ros-version=/);
  assert.equal(validateGeneratedRouterScript(script), script);
});

test("coexistence can reuse both manually created management OpenVPN clients", () => {
  const script = buildMainhotspotRsc(
    "https://come.isplatty.org/api/scripts",
    "",
    "come1",
    "Ochola SuperNet",
    "",
    "",
    "",
    "https://come.isplatty.org/api/scripts/router-vpn-bootstrap/90/Abcdefghijklmno_1234567890",
    "https://come.isplatty.org/api/scripts/router-vpn-bootstrap/90/Abcdefghijklmno_1234567890/openvpn-backup",
    "",
    "",
    "10.8.5.90",
    "ochola-mgmt-vpn-90",
    "",
    "verified",
    "coexist",
  );

  assert.match(script, /Existing primary and backup management OpenVPN clients found; skipping VPN child downloads/);
  assert.match(script, /name="ochola-mgmt-vpn-90"/);
  assert.match(script, /name="ochola-mgmt-vpn-90-backup"/);
  assert.equal(validateGeneratedRouterScript(script), script);
});