import test from "node:test";
import assert from "node:assert/strict";
import { buildDualServiceCommands } from "./port-services-route.js";

const port = {
  id: 12,
  admin_id: 7,
  reseller_id: 9,
  assigned_reseller_id: 9,
  router_id: 3,
  interface_name: "ether2",
  bridge_name: null,
  hotspot_enabled: true,
  hotspot_template_path: "hotspot/portal-a",
  hotspot_folder_path: "hotspot/portal-a",
    hotspot_dns_name: null,
  pppoe_enabled: true,
  pppoe_folder_path: "hotspot/pppoe-a",
    pppoe_dns_name: null,
  reseller_bandwidth_cap: 30,
  bandwidth_cap_mbps: 30,
  subnet_range: "192.168.30.0/24",
  status: "active",
  provisioning_error: null,
};

test("a port service gets isolated Hotspot and PPPoE resources", () => {
  const commands = buildDualServiceCommands(
    port,
    "flash/hotspot/hs_ether2",
    "flash/hotspot/pppoe_ether2",
    "10.8.5.2",
    { portalHostname: "come.isplatty.org" },
  );
  const script = commands.map(([path, ...args]) => `${path} ${args.join(" ")}`).join("\n");

  assert.match(script, /\/interface\/bridge\/add =name=ochola-port-12/);
  assert.match(script, /\/interface\/bridge\/port\/add =bridge=ochola-port-12 =interface=ether2/);
  assert.match(script, /\/ip\/hotspot\/add =name=HS_ether2 =interface=ochola-port-12/);
  assert.match(script, /html-directory=flash\/hotspot\/hs_ether2/);
  assert.match(script, /\/interface\/pppoe-server\/server\/add =service-name=PPPoE_ether2 =interface=ochola-port-12/);
  assert.match(script, /dst-host=come\.isplatty\.org/);
  assert.match(script, /address=192\.168\.30\.1\/24/);
  assert.match(script, /target=192\.168\.30\.0\/24 =parent=RESELLER_ROOT_ether2/);
  assert.match(script, /\/ip\/firewall\/filter\/add =chain=input =in-interface=ochola-port-12 =protocol=udp =dst-port=53/);
  assert.match(script, /\/ip\/firewall\/filter\/add =chain=forward =in-interface=ochola-port-12 =out-interface-list=WAN =action=accept/);
  assert.match(script, /block_wan_dns_tcp/);
  assert.doesNotMatch(script, /interface=ether2 =profile=HS_ether2/);
});

test("port service profiles accept independent DNS names and allow the Hotspot name", () => {
  const commands = buildDualServiceCommands(
    port,
    "flash/hotspot/hs_ether2",
    "flash/hotspot/pppoe_ether2",
    "10.8.5.2",
    {
      portalHostname: "come.isplatty.org",
      hotspotDnsName: "hotspot-ether2.example.com",
      pppoeDnsName: "pppoe-ether2.example.com",
    },
  );
  const script = commands.map(([path, ...args]) => `${path} ${args.join(" ")}`).join("\n");

  assert.match(script, /name=HS_ether2.*dns-name=hotspot-ether2\.example\.com/);
  assert.match(script, /name=PPPOE_ALERT_ether2.*dns-name=pppoe-ether2\.example\.com/);
  assert.match(script, /dst-host=hotspot-ether2\.example\.com/);
});

test("port services reject non-private or non-/24 networks", () => {
  assert.throws(
    () => buildDualServiceCommands({ ...port, subnet_range: "198.51.100.0/24" }, "flash/hotspot/hs_ether2", null, "10.8.5.2"),
    /private network address/,
  );
  assert.throws(
    () => buildDualServiceCommands({ ...port, subnet_range: "192.168.30.0/23" }, "flash/hotspot/hs_ether2", null, "10.8.5.2"),
    /private network address/,
  );
});

test("different assigned ports receive different service identities", () => {
  const first = buildDualServiceCommands(port, "flash/hotspot/hs_ether2", null, "10.8.5.2");
  const second = buildDualServiceCommands(
    { ...port, id: 13, interface_name: "ether3", subnet_range: "192.168.31.0/24" },
    "flash/hotspot/hs_ether3",
    null,
    "10.8.5.2",
  );
  const firstScript = first.flat().join(" ");
  const secondScript = second.flat().join(" ");

  assert.match(firstScript, /ochola-port-12/);
  assert.match(secondScript, /ochola-port-13/);
  assert.match(firstScript, /HS_ether2/);
  assert.match(secondScript, /HS_ether3/);
  assert.notEqual(firstScript, secondScript);
});