type RouterHotspotServer = Record<string, unknown>;

export function selectUniqueActiveHotspotServer(
  rows: unknown,
  requestedInterface?: string,
): {
  activeServers: RouterHotspotServer[];
  candidates: RouterHotspotServer[];
  selected: RouterHotspotServer | null;
} {
  const activeServers = (Array.isArray(rows) ? rows : []).filter((row): row is RouterHotspotServer => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const interfaceName = String(row.interface ?? "").trim();
    const disabled = /^(?:true|yes)$/i.test(String(row.disabled ?? "").trim());
    return Boolean(interfaceName) && !disabled;
  });
  const candidates = requestedInterface
    ? activeServers.filter(row => String(row.interface ?? "").trim() === requestedInterface)
    : activeServers;

  return {
    activeServers,
    candidates,
    selected: candidates.length === 1 ? candidates[0] : null,
  };
}