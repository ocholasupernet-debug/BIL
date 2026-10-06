export const OCHOLA_HOTSPOT_CHAT_WALLED_GARDEN_RULES = [
  { dstHost: "*.tawk.to", comment: "Allow tawk.to Chat Engine" },
  { dstHost: "*.tawk.link", comment: "Allow tawk.to Calling Assets" },
  { dstHost: "ocholasupernet.isplatty.org", comment: "Allow OcholaSupernet Portal Domain" },
] as const;

function routerOsString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildHotspotChatWalledGardenCommands(serverName?: string): string[][] {
  return OCHOLA_HOTSPOT_CHAT_WALLED_GARDEN_RULES.map(({ dstHost, comment }) => [
    "/ip/hotspot/walled-garden/add",
    ...(serverName ? [`=server=${serverName}`] : []),
    `=dst-host=${dstHost}`,
    "=action=allow",
    `=comment=${comment}`,
  ]);
}

type ExistingHotspotWalledGardenEntry = {
  server?: string;
  "dst-host"?: string;
  action?: string;
  disabled?: string;
};

export function planHotspotChatWalledGardenAdds(
  existingEntries: ExistingHotspotWalledGardenEntry[],
  serverName?: string,
): {
  commands: string[][];
  alreadyAllowed: string[];
  conflicts: string[];
} {
  const generatedCommands = buildHotspotChatWalledGardenCommands(serverName);
  const commands: string[][] = [];
  const alreadyAllowed: string[] = [];
  const conflicts: string[] = [];
  const targetServer = serverName?.toLowerCase();

  OCHOLA_HOTSPOT_CHAT_WALLED_GARDEN_RULES.forEach(({ dstHost }, index) => {
    const applicableEntries = existingEntries.filter((entry) => {
      if (entry["dst-host"] !== dstHost) return false;
      if (["true", "yes", "1"].includes(entry.disabled?.toLowerCase() ?? "")) return false;
      const entryServer = entry.server?.trim().toLowerCase() ?? "";
      return targetServer
        ? !entryServer || entryServer === "all" || entryServer === targetServer
        : !entryServer || entryServer === "all";
    });
    if (applicableEntries.some((entry) => entry.action?.toLowerCase() === "deny")) {
      conflicts.push(dstHost);
    } else if (applicableEntries.some((entry) => entry.action?.toLowerCase() === "allow")) {
      alreadyAllowed.push(dstHost);
    } else {
      const command = generatedCommands[index];
      if (command) commands.push(command);
    }
  });

  return { commands, alreadyAllowed, conflicts };
}

export function renderHotspotChatWalledGardenRules(serverName?: string): string {
  const serverFilter = serverName ? `server=${routerOsString(serverName)} && ` : "";
  const serverArgument = serverName ? ` server=${routerOsString(serverName)}` : "";
  const rules = OCHOLA_HOTSPOT_CHAT_WALLED_GARDEN_RULES.map(({ dstHost, comment }) => {
    const quotedComment = routerOsString(comment);
    return `:if ([:len [/ip hotspot walled-garden find where ${serverFilter}dst-host=${dstHost} && action=allow && comment=${quotedComment}]] = 0) do={
    add${serverArgument} dst-host=${dstHost} action=allow comment=${quotedComment}
}`;
  });

  return ["/ip hotspot walled-garden", ...rules].join("\n");
}
