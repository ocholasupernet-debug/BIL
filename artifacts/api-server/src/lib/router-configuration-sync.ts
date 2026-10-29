type RouterRule = Record<string, string>;

function enabled(rule: RouterRule): boolean {
  return rule.disabled !== "true" && rule.disabled !== "yes";
}

export function buildRouterConfigurationSyncPlan(input: {
  hotspotInterfaces: RouterRule[];
  filterRules: RouterRule[];
  mangleRules: RouterRule[];
}): { commands: string[][]; hotspotInterfaces: string[]; unsafeGlobalTtlComments: string[] } {
  const hotspotInterfaces = [...new Set(input.hotspotInterfaces
    .filter(row => enabled(row) && row.interface && row.interface !== "all")
    .map(row => row.interface.trim())
    .filter(Boolean))];
  const commands: string[][] = [];
  const unsafeGlobalTtlComments = input.mangleRules
    .filter(rule => enabled(rule)
      && rule.chain === "postrouting"
      && rule.action === "change-ttl"
      && rule["new-ttl"] === "set:1"
      && !rule["out-interface"]
      && !rule["out-interface-list"])
    .map(rule => rule.comment?.trim() || "unlabeled TTL=1 rule");
  if (unsafeGlobalTtlComments.length > 0) {
    return { commands, hotspotInterfaces, unsafeGlobalTtlComments };
  }

  for (const rule of input.filterRules) {
    if (enabled(rule) && rule[".id"] && rule.action === "fasttrack-connection") {
      commands.push(["/ip/firewall/filter/disable", `=.id=${rule[".id"]}`]);
    }
  }

  for (const interfaceName of hotspotInterfaces) {
    const comment = `Block Hotspot Tethering - ${interfaceName}`;
    const existing = input.mangleRules.find(rule =>
      rule.comment === comment
      && rule.chain === "postrouting"
      && rule.action === "change-ttl"
      && rule["new-ttl"] === "set:1"
      && rule["out-interface"] === interfaceName,
    );
    if (existing?.[".id"]) {
      if (!enabled(existing)) commands.push(["/ip/firewall/mangle/enable", `=.id=${existing[".id"]}`]);
      if (input.mangleRules.indexOf(existing) > 0) {
        commands.push(["/ip/firewall/mangle/move", `=.id=${existing[".id"]}`, "=destination=0"]);
      }
      continue;
    }
    commands.push([
      "/ip/firewall/mangle/add",
      "=chain=postrouting",
      "=action=change-ttl",
      "=new-ttl=set:1",
      `=out-interface=${interfaceName}`,
      "=place-before=0",
      `=comment=${comment}`,
    ]);
  }

  return { commands, hotspotInterfaces, unsafeGlobalTtlComments };
}
