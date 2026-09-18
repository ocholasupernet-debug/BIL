import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBillingInitRsc,
  buildCoexistenceHotspotRsc,
  buildMainhotspotRsc,
  getDeployableSource,
  listDeployableSources,
  validateOnboardingInputs,
  validateGeneratedRouterScript,
} from "../src/routes/scripts-route.ts";
import { buildMainIspConfigurationRsc } from "../src/routes/isp-configuration-route.ts";
import { buildManagementApiRepairScript } from "../src/lib/router-management-repair.ts";
import { buildDualServiceCommands } from "../src/routes/port-services-route.ts";

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

  assert.doesNotThrow(() => validateGeneratedRouterScript(script));
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
  assert.doesNotThrow(() => validateGeneratedRouterScript(script));
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
  assert.match(script, /router-vpn-bootstrap\/90\/Abcdefghijklmno_1234567890\/7\.rsc\?mode=direct/);
  assert.match(script, /router-vpn-bootstrap\/90\/Abcdefghijklmno_1234567890\/7\/openvpn-backup\.rsc\?mode=direct/);
  assert.doesNotMatch(script, /https:\/\/come\.isplatty\.org\/scripts\/vpn7-backup\.rsc/);
  assert.match(script, /hotspotsetup\.rsc/);
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

test("Greenfield provisioning is a distinct non-reset installer", () => {
  const script = buildMainhotspotRsc(
    "https://come.isplatty.org/api/scripts",
    "",
    "come1",
    "Ochola SuperNet",
    "", "", "", "", "", "", "", "", "", "", "verified", "greenfield",
  );

  assert.match(script, /Greenfield Provisioning|Greenfield Setup Script/);
  assert.match(script, /hotspotsetup\.rsc/);
  assert.match(script, /pppoesetup\.rsc/);
  assert.match(script, /Initializing Billing Script Injection Layer/);
  assert.match(script, /radius incoming set accept=yes port=3799/);
  assert.doesNotMatch(script, /reset-configuration/);
  assert.doesNotMatch(script, /TAKEOVER BACKUP VERIFIED/);
  assert.equal(validateGeneratedRouterScript(script), script);
});

test("Zero-Touch stages billing_init.rsc and uses the exact RouterOS reset contract", () => {
  const script = buildMainhotspotRsc(
    "https://come.isplatty.org/api/scripts",
    "",
    "come1",
    "Ochola SuperNet",
    "", "", "", "", "", "", "", "", "", "", "verified", "ztp_takeover", "",
    "https://come.isplatty.org/api/scripts/billing-init/90/1/tko.example.rsc",
  );

  assert.match(script, /billing_init\.rsc/);
  assert.match(script, /\/system\/reset-configuration keep-users=no no-defaults=yes run-after-reset=billing_init\.rsc/);
  assert.equal(validateGeneratedRouterScript(script), script);

  const bootstrap = buildBillingInitRsc(
    "https://come.isplatty.org/api/scripts",
    "https://come.isplatty.org/api/scripts/self-install-mainhotspot/90/1/tko.example?bootstrap=greenfield",
    "come1",
  );
  assert.match(bootstrap, /billing-bridge/);
  assert.match(bootstrap, /\/ip dhcp-client add interface=\$wan/);
  assert.match(bootstrap, /bootstrap=greenfield/);
  assert.equal(validateGeneratedRouterScript(bootstrap), bootstrap);
});

test("onboarding input validation rejects invalid CIDRs and duplicate services", () => {
  assert.doesNotThrow(() => validateOnboardingInputs({
    cidrs: ["192.168.88.0/24"],
    serviceNames: ["billing-bridge", "hotspot1"],
    bandwidths: [{ down: 30, up: 10, unit: "Mbps" }],
  }));
  assert.throws(
    () => validateOnboardingInputs({ cidrs: ["192.168.88.0/33"] }),
    /valid IPv4 octets|CIDR prefix/,
  );
  assert.throws(
    () => validateOnboardingInputs({ serviceNames: ["billing-bridge", "billing-bridge"] }),
    /Duplicate RouterOS service name/,
  );
});

test("Brownfield bundle stays owned, isolated, and service-complete", () => {
  const script = buildCoexistenceHotspotRsc(
    "https://come.isplatty.org/api/scripts",
    "90",
    1,
    "come1",
    "Ochola SuperNet",
    [{ name: "Home 30", speed_down: 30, speed_up: 10, validity: 30, validity_unit: "days", shared_users: 1 }],
    "verified",
  );

  assert.match(script, /Ochola SuperNet coexistence router 90/);
  assert.match(script, /interface pppoe-server server add/);
  assert.match(script, /service=hotspot,ppp address=\$radiusAddress secret=\$radiusSecret/);
  assert.match(script, /radius incoming set accept=yes port=3799/);
  assert.match(script, /hotspot\/hs_/);
  assert.doesNotMatch(script, /\/interface bridge remove/);
  assert.doesNotMatch(script, /\/ip firewall filter remove \[find\]/);
  assert.doesNotThrow(() => validateGeneratedRouterScript(script));
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

test("dual-service port compilation isolates assets and prioritizes PPPoE", () => {
  const commands = buildDualServiceCommands({
    id: 7,
    admin_id: 12,
    reseller_id: 44,
    assigned_reseller_id: 44,
    router_id: 90,
    interface_name: "ether2",
    hotspot_enabled: true,
    hotspot_template_path: "portal.html",
    hotspot_folder_path: "portal.html",
    pppoe_enabled: true,
    pppoe_folder_path: "expired.html",
    reseller_bandwidth_cap: 50,
    bandwidth_cap_mbps: 50,
    subnet_range: "192.168.30.0/24",
    status: "active",
  }, "flash/hotspot/hs_ether2", "flash/hotspot/pppoe_ether2", "192.168.88.1");

  const text = commands.map(command => command.join(" ")).join("\n");
  assert.match(text, /html-directory=flash\/hotspot\/hs_ether2/);
  assert.match(text, /html-directory=flash\/hotspot\/pppoe_ether2/);
  assert.match(text, /name=RESELLER_ROOT_ether2/);
  assert.match(text, /parent=RESELLER_ROOT_ether2.*priority=1\/1/);
  assert.match(text, /parent=RESELLER_ROOT_ether2.*priority=8\/8/);
  assert.match(text, /pppoe_billing_redirect/);
});

test("every published RouterOS source passes final compilation validation", () => {
  for (const source of listDeployableSources().filter(item => item.type === "script")) {
    const result = getDeployableSource("script", source.name, "https://come.isplatty.org");
    assert.ok(result, `missing generated source ${source.name}`);
    assert.equal(validateGeneratedRouterScript(result.content.toString("utf8")), result.content.toString("utf8"), source.name);
    assert.equal(result.content.toString("utf8").endsWith("\n"), true, `${source.name} must end with a newline`);
  }
});