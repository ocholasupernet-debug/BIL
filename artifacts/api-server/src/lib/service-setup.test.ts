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
  assert.match(script, /192\.168\.88\.1\/24/);
  assert.match(script, /ip dhcp-server add/);
  assert.match(script, /ip dhcp-server add name="ochola-services-104-dhcp" interface="co-hotspot-bridge-104" address-pool="ochola-services-104-hotspot-pool" disabled=no\n/);
  assert.doesNotMatch(script, /ip dhcp-server (?:add|set)[^\n]*comment=/);
  assert.match(script, /ip hotspot profile add/);
  assert.doesNotMatch(script, /ip hotspot profile (?:add|set)[^\n]*address-pool=/);
  assert.doesNotMatch(script, /ip hotspot profile (?:add|set)[^\n]*comment=/);
  assert.match(script, /ip hotspot add/);
  assert.match(script, /ip hotspot add[^\n]*address-pool="ochola-services-104-hotspot-pool"/);
  assert.doesNotMatch(script, /ip hotspot (?:add|set)[^\n]*comment=/);
  assert.match(script, /walled-garden ip add dst-host="come\.isplatty\.org"/);
  assert.match(script, /interface pppoe-server server add/);
  assert.match(script, /192\.168\.99\.10-192\.168\.99\.254/);
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