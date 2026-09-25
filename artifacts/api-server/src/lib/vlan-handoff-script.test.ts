import test from "node:test";
import assert from "node:assert/strict";
import { buildVlanHandoffScript } from "./vlan-handoff-script.js";
import type { VlanIngressMode } from "./port-service-resources.js";

const versions = ["6.49.18", "7.18.2"];

for (const rosVersion of versions) {
  for (const ingressMode of ["tagged", "untagged"] satisfies VlanIngressMode[]) {
    test(`RouterOS ${rosVersion} VLAN handoff script configures ${ingressMode} ingress safely`, () => {
      const script = buildVlanHandoffScript({
        bridgeName: "isp-hotspot",
        ingressInterface: "ether7",
        vlanName: "OCHOLA_RS42_VLAN210",
        vlanTag: 210,
        ingressMode,
      });

      assert.match(script, /:local parentBridge "isp-hotspot";/);
      assert.match(script, /:local ingressInterface "ether7";/);
      assert.match(script, /:local ingressMode "(tagged|untagged)";/);
      assert.match(script, /find where bridge=\$parentBridge/);
      assert.match(script, /find where interface=\$ingressInterface/);
      assert.match(script, /Selected ingress already belongs to another bridge/);
      assert.match(script, /:set members \(\$members \. "," \. \$(parentBridge|ingressInterface)\)/);
      assert.match(script, /:local taggedMembers \[\/interface bridge vlan get \$vlanRef tagged\]/);
      assert.match(script, /:local members \[\/interface bridge vlan get \$vlanRef (tagged|untagged)\]/);
      assert.match(script, /\/interface bridge vlan set \$vlanRef (tagged|untagged)=\$members;/);
      assert.match(script, /:error "The VLAN interface name is already used by another VLAN or bridge\."/);
      assert.doesNotMatch(script, /vlan-filtering\s*=\s*yes/i);
      assert.doesNotMatch(script, /\/interface\/bridge\/port\/remove|\/interface bridge port remove/);
      assert.doesNotMatch(script, /ether[1-6]|ether8/);

      if (ingressMode === "tagged") {
        assert.match(script, /:local taggedMembers \(\$parentBridge \. "," \. \$ingressInterface\)/);
        assert.match(script, /bridge vlan add bridge=\$parentBridge vlan-ids=\$vlanId tagged=\$taggedMembers/);
        assert.match(script, /bridge port add bridge=\$parentBridge interface=\$ingressInterface comment=/);
        assert.doesNotMatch(script, /interface bridge port add bridge=\$parentBridge interface=\$ingressInterface pvid=/);
      } else {
        assert.match(script, /bridge vlan add bridge=\$parentBridge vlan-ids=\$vlanId tagged=\$parentBridge untagged=\$ingressInterface/);
        assert.match(script, /bridge port add bridge=\$parentBridge interface=\$ingressInterface pvid=\$vlanId/);
      }
    });
  }
}

test("VLAN handoff scripts reject ambiguous ingress modes and invalid interface input", () => {
  const base = {
    bridgeName: "isp-hotspot",
    ingressInterface: "ether7",
    vlanName: "OCHOLA_RS42_VLAN210",
    vlanTag: 210,
    ingressMode: "tagged" as const,
  };

  assert.throws(() => buildVlanHandoffScript({ ...base, ingressMode: "automatic" as VlanIngressMode }), /valid RouterOS/);
  assert.throws(() => buildVlanHandoffScript({ ...base, ingressInterface: "isp-hotspot" }), /valid RouterOS/);
});