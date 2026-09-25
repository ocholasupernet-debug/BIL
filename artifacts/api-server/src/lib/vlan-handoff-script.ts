import type { VlanIngressMode } from "./port-service-resources.js";

export type VlanHandoffScriptInput = {
  bridgeName: string;
  ingressInterface: string;
  vlanName: string;
  vlanTag: number;
  ingressMode: VlanIngressMode;
};

function validRouterInterface(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value);
}

function quoteRouterValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function membershipAppendScript(property: "tagged" | "untagged", interfaceVariable: string): string[] {
  return [
    `    :local members [/interface bridge vlan get $vlanRef ${property}];`,
    `    :if ([:find ("," . $members . ",") ("," . $${interfaceVariable} . ",")] = nil) do={`,
    `      :if ([:len $members] = 0) do={ :set members $${interfaceVariable}; } else={ :set members ($members . "," . $${interfaceVariable}); }`,
    `      /interface bridge vlan set $vlanRef ${property}=$members;`,
    "    }",
  ];
}

export function buildVlanHandoffScript(input: VlanHandoffScriptInput): string {
  const { bridgeName, ingressInterface, vlanName, vlanTag, ingressMode } = input;
  if (
    !validRouterInterface(bridgeName)
    || !validRouterInterface(ingressInterface)
    || ingressInterface === bridgeName
    || !validRouterInterface(vlanName)
    || !Number.isSafeInteger(vlanTag)
    || vlanTag < 1
    || vlanTag > 4094
    || (ingressMode !== "tagged" && ingressMode !== "untagged")
  ) {
    throw new Error("This VLAN handoff does not have valid RouterOS interface, VLAN, or ingress-mode details.");
  }

  const ingressAppend = membershipAppendScript(ingressMode, "ingressInterface");
  const bridgePortSetup = ingressMode === "untagged"
    ? [
      "  /interface bridge port add bridge=$parentBridge interface=$ingressInterface pvid=$vlanId comment=\"OcholaSupernet VLAN ingress\";",
    ]
    : [
      "  /interface bridge port add bridge=$parentBridge interface=$ingressInterface comment=\"OcholaSupernet VLAN ingress\";",
    ];
  const existingPortSetup = ingressMode === "untagged"
    ? [
      "  /interface bridge port set $ingressRef disabled=no pvid=$vlanId;",
    ]
    : [
      "  /interface bridge port set $ingressRef disabled=no;",
    ];
  const newVlanEntry = ingressMode === "tagged"
    ? [
      "  :local taggedMembers ($parentBridge . \",\" . $ingressInterface);",
      "  /interface bridge vlan add bridge=$parentBridge vlan-ids=$vlanId tagged=$taggedMembers comment=\"OcholaSupernet VLAN ingress\";",
    ]
    : [
      "  /interface bridge vlan add bridge=$parentBridge vlan-ids=$vlanId tagged=$parentBridge untagged=$ingressInterface comment=\"OcholaSupernet VLAN ingress\";",
    ];
  const oppositeMembership = ingressMode === "tagged" ? "untagged" : "tagged";

  return [
    "# OcholaSupernet reseller VLAN handoff",
    "# Apply only to the selected bridge and physical ingress port.",
    "# Existing VLAN members are preserved; bridge vlan-filtering is left unchanged.",
    `:local parentBridge "${quoteRouterValue(bridgeName)}";`,
    `:local ingressInterface "${quoteRouterValue(ingressInterface)}";`,
    `:local vlanName "${quoteRouterValue(vlanName)}";`,
    `:local vlanId ${vlanTag};`,
    `:local ingressMode "${ingressMode}";`,
    ":if ([:len [/interface bridge find where name=$parentBridge]] = 0) do={ :error \"Selected bridge was not found.\"; }",
    ":if ([:len [/interface find where name=$ingressInterface]] = 0) do={ :error \"Selected ingress interface was not found.\"; }",
    ":if ([:len [/interface bridge find where name=$ingressInterface]] > 0) do={ :error \"The ingress interface must be a physical port, not a bridge.\"; }",
    ":if ([:len [/interface vlan find where name=$ingressInterface]] > 0) do={ :error \"The ingress interface must not be a VLAN interface.\"; }",
    ":local ingressRows [/interface bridge port find where interface=$ingressInterface];",
    ":if ([:len $ingressRows] > 0) do={",
    "  :local ingressRef [:pick $ingressRows 0];",
    "  :if ([/interface bridge port get $ingressRef bridge] != $parentBridge) do={ :error \"Selected ingress already belongs to another bridge.\"; }",
    ...existingPortSetup,
    "} else={",
    ...bridgePortSetup,
    "}",
    ":local vlanRows [/interface bridge vlan find where bridge=$parentBridge];",
    ":local vlanIdText [:tostr $vlanId];",
    ":local matchingVlan false;",
    ":foreach vlanRef in=$vlanRows do={",
    "  :local existingVlanIds [/interface bridge vlan get $vlanRef vlan-ids];",
    "  :if ([:find (\",\" . $existingVlanIds . \",\") (\",\" . $vlanIdText . \",\")] != nil) do={",
    "    :set matchingVlan true;",
    `    :local oppositeMembers [/interface bridge vlan get $vlanRef ${oppositeMembership}];`,
    "    :if ([:find (\",\" . $oppositeMembers . \",\") (\",\" . $ingressInterface . \",\")] != nil) do={ :error \"Selected ingress is already in the opposite VLAN membership; resolve that entry before applying this script.\"; }",
    "    :local taggedMembers [/interface bridge vlan get $vlanRef tagged];",
    "    :if ([:find (\",\" . $taggedMembers . \",\") (\",\" . $parentBridge . \",\")] = nil) do={",
    "      :if ([:len $taggedMembers] = 0) do={ :set taggedMembers $parentBridge; } else={ :set taggedMembers ($taggedMembers . \",\" . $parentBridge); }",
    "      /interface bridge vlan set $vlanRef tagged=$taggedMembers;",
    "    }",
    ...ingressAppend,
    "  }",
    "}",
    ":if (!$matchingVlan) do={",
    ...newVlanEntry,
    "}",
    ":local existingVlanInterfaces [/interface vlan find where name=$vlanName];",
    ":if ([:len $existingVlanInterfaces] > 0) do={",
    "  :local vlanRef [:pick $existingVlanInterfaces 0];",
    "  :if ([/interface vlan get $vlanRef vlan-id] != $vlanId || [/interface vlan get $vlanRef interface] != $parentBridge) do={ :error \"The VLAN interface name is already used by another VLAN or bridge.\"; }",
    "  /interface vlan set $vlanRef disabled=no;",
    "} else={",
    "  /interface vlan add name=$vlanName vlan-id=$vlanId interface=$parentBridge comment=\"OcholaSupernet reseller VLAN\";",
    "}",
    ":put (\"Ready: \" . $vlanName . \" on \" . $parentBridge . \" with VLAN \" . $vlanId . \" (\" . $ingressMode . \" ingress)\");",
    "",
  ].join("\n");
}