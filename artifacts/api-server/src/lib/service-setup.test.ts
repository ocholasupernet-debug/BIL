import test from "node:test";
import assert from "node:assert/strict";
import { generateServiceSetupScript } from "./mikrotik.js";

test("service setup links the shared bridge to Hotspot and PPPoE", () => {
  const script = generateServiceSetupScript({
    routerId: 104,
    bridgeName: "co-hotspot-bridge-104",
    bridgePorts: ["ether2", "ether3"],
    portalHostnames: ["come.isplatty.org"],
    portalFileUrls: {
      login: "https://isplatty.org/api/router-file-source/104/hotspot-login.html",
      roamingLogin: "https://isplatty.org/api/router-file-source/104/hotspot-rlogin.html",
      md5: "https://isplatty.org/api/router-file-source/104/hotspot-md5.js",
    },
  });

  assert.match(script, /servicessetup\.rsc/);
  assert.match(script, /co-hotspot-bridge-104/);
  assert.match(script, /interface bridge port add/);
  assert.match(script, /192\.168\.180\.1\/22/);
  assert.match(script, /ip dhcp-server add/);
  assert.match(script, /ip dhcp-server add name="ochola-services-104-dhcp" interface="co-hotspot-bridge-104" address-pool="hotspot pool" disabled=no\n/);
  assert.doesNotMatch(script, /ip dhcp-server (?:add|set)[^\n]*comment=/);
  assert.match(script, /ip hotspot profile add/);
  assert.match(script, /ip hotspot profile add name="hsprof"/);
  assert.doesNotMatch(script, /ip hotspot profile (?:add|set)[^\n]*address-pool=/);
  assert.doesNotMatch(script, /ip hotspot profile (?:add|set)[^\n]*comment=/);
  assert.match(script, /ip hotspot add/);
  assert.match(script, /ip hotspot add name="hotspot"[^\n]*profile="hsprof" address-pool="hotspot pool"/);
  assert.doesNotMatch(script, /ip hotspot (?:add|set)[^\n]*comment=/);
  assert.match(script, /walled-garden ip add dst-host="come\.isplatty\.org"/);
  assert.match(script, /walled-garden ip add dst-host="api\.safaricom\.co\.ke"/);
  assert.match(script, /payment walled garden api\.safaricom\.co\.ke/);
  assert.match(script, /walled-garden ip add dst-host="checkout\.stripe\.com"/);
  assert.match(script, /SCRIPT 4 optional bandwidth tree starting/);
  assert.match(script, /no aggregate queue speed was supplied; existing bandwidth policy was preserved/);
  assert.match(script, /interface pppoe-server server add/);
  assert.match(script, /192\.168\.180\.10-192\.168\.183\.254/);
  assert.match(script, /interface list member add list="LAN" interface="co-hotspot-bridge-104"/);
  assert.match(script, /chain=forward action=accept in-interface="co-hotspot-bridge-104" out-interface-list=WAN hotspot=auth/);
  assert.match(script, /chain=forward action=accept src-address="192\.168\.99\.0\/24" out-interface-list=WAN/);
  assert.doesNotMatch(script, /chain=forward action=accept in-interface="co-hotspot-bridge-104" out-interface-list=WAN connection-state=new,established,related comment="ochola-services-104 service-to-wan"/);
  assert.match(script, /ip dns set allow-remote-requests=yes/);
  assert.match(script, /chain=input action=accept in-interface="co-hotspot-bridge-104" protocol=udp dst-port=53/);
  assert.match(script, /chain=input action=accept in-interface="co-hotspot-bridge-104" protocol=tcp dst-port=53/);
  assert.match(script, /Hotspot masquerade/);
  assert.match(script, /PPPoE masquerade/);
  assert.match(script, /dst-path="hotspot\/login\.html" mode=https check-certificate=yes/);
  assert.match(script, /dst-path="hotspot\/rlogin\.html" mode=https check-certificate=yes/);
  assert.match(script, /dst-path="hotspot\/md5\.js" mode=https check-certificate=yes/);
  assert.match(script, /file find where name="hotspot\/login\.html"/);
  assert.match(script, /SERVICE STEP 1\/7 - portal files starting/);
  assert.match(script, /SERVICE STEP 2\/7 - service bridge starting/);
  assert.match(script, /SERVICE STEP 4\/7 - Hotspot DHCP, profile, and server starting/);
  assert.match(script, /SERVICE STEP 7\/7 - customer NAT starting/);
  assert.match(script, /servicessetup\.rsc finished with failed service steps/);
  assert.match(script, /Fix the listed failures and rerun servicessetup\.rsc/);
  assert.doesNotMatch(script, /pppoe-server server (?:add|set)[^\n]*comment=/);
});

test("service setup rejects unsafe bridge names and preserves foreign bridge ports", () => {
  assert.throws(
    () => generateServiceSetupScript({ bridgeName: "bad bridge" }),
    /Service bridge name/,
  );

  const script = generateServiceSetupScript({
    routerId: 104,
    bridgeName: "co-hotspot-bridge-104",
    bridgePorts: ["ether2"],
  });
  assert.match(script, /already assigned to foreign bridge/);
  assert.doesNotMatch(script, /bridge port remove/);
});

test("service setup keeps PPPoE on hotspot-bridge with the /22 Hotspot gateway", () => {
  const script = generateServiceSetupScript({ routerId: 104, bridgeName: "hotspot-bridge" });
  assert.match(script, /ip address add address="192\.168\.180\.1\/22" interface="hotspot-bridge"/);
  assert.match(script, /ip dhcp-server add name="ochola-services-104-dhcp" interface="hotspot-bridge"/);
  assert.match(script, /pppoe-server server add service-name="ochola-services-104-pppoe" interface="hotspot-bridge"/);
  assert.match(script, /ip hotspot add name="hotspot" interface="hotspot-bridge"/);
  assert.doesNotMatch(script, /interface bridge add name="hotspot-bridge" comment=/);
  assert.match(script, /interface bridge set \[find where name="hotspot-bridge"\] comment=""/);
});

test("service setup adds the optional shared-wire queue tree without changing the walled garden", () => {
  const script = generateServiceSetupScript({
    routerId: 104,
    bridgeName: "co-hotspot-bridge-104",
    maxPortSpeedMbps: 100,
    portalHostnames: ["come.isplatty.org"],
  });
  assert.match(script, /name="ochola-services-104-root" target="co-hotspot-bridge-104" max-limit="100M\/100M" priority=2\/2/);
  assert.match(script, /name="ochola-services-104-pppoe" target="192\.168\.99\.0\/24" parent="ochola-services-104-root"[^\\n]*priority=1\/1/);
  assert.match(script, /name="ochola-services-104-hotspot" target="192\.168\.180\.0\/22" parent="ochola-services-104-root"[^\\n]*priority=8\/8/);
  assert.match(script, /walled-garden ip add dst-host="come\.isplatty\.org"/);
});

test("coexistence service setup compiles one isolated, delayed payload", () => {
  const script = generateServiceSetupScript({
    installationMode: "coexist",
    routerId: 90,
    bridgeName: "br-ochola-coexist",
    bridgePorts: ["ether3"],
    portName: "ether3",
    radiusIp: "10.8.5.1",
    radiusSecret: "radius-test-secret",
  });

  assert.match(script, /# OcholaSupernet - Brownfield Coexistence service plane/);
  assert.match(script, /interface bridge find where name="br-ochola-coexist"/);
  assert.match(script, /interface bridge add name="br-ochola-coexist"/);
  assert.match(script, /172\.16\.99\.1\/24/);
  assert.match(script, /172\.16\.99\.10-172\.16\.99\.254/);
  assert.match(script, /html-directory="flash\/hotspot\/coexist_hs_ether3"/);
  assert.match(script, /ip hotspot add name="coexist_hs_ether3"/);
  assert.match(script, /service-name="pppoe_ochola_ether3"/);
  assert.match(script, /service-name="pppoe_ochola_ether3"/);
  assert.match(script, /\/radius add service="hotspot,ppp" address="10\.8\.5\.1"/);
  assert.match(script, /comment="Ochola Platform Link - Coexist Mode"/);
  assert.match(script, /radius incoming set .*accept=yes/);
  assert.match(script, /radius incoming set .*port=3799/);
  assert.match(script, /:delay 2s;/);
  assert.equal((script.match(/:delay 2s;/g) ?? []).length, 7);
  assert.equal(script.endsWith("\n"), true);
});

test("coexistence never removes defaults or moves foreign resources", () => {
  const script = generateServiceSetupScript({
    installationMode: "coexist",
    routerId: 90,
    bridgePorts: ["ether3"],
  });

  assert.doesNotMatch(script, /bridge remove|bridge set/);
  assert.doesNotMatch(script, /\/ip address remove|\/ip route (?:remove|set)/);
  assert.doesNotMatch(script, /\/radius remove|\/radius incoming remove/);
  assert.match(script, /belongs to foreign bridge/);
  assert.match(script, /platform RADIUS profile skipped; existing RADIUS entries were preserved/);
});

test("coexistence compiles without a platform RADIUS pair", () => {
  const script = generateServiceSetupScript({
    installationMode: "coexist",
    routerId: 91,
    bridgeName: "co-hotspot-bridge",
    bridgePorts: ["ether4"],
    portName: "ether4",
    radiusIp: undefined,
    radiusSecret: undefined,
  });

  assert.match(script, /platform RADIUS profile skipped; existing RADIUS entries were preserved/);
});

test("coexistence rejects incomplete or unsafe RADIUS configuration", () => {
  assert.throws(
    () => generateServiceSetupScript({
      installationMode: "coexist",
      radiusIp: "10.8.5.1",
    }),
    /must include both address and secret/,
  );
  assert.throws(
    () => generateServiceSetupScript({
      installationMode: "coexist",
      radiusIp: "10.8.5.1",
      radiusSecret: 'unsafe"secret',
    }),
    /unsafe characters/,
  );
});
