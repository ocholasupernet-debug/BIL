export type NamedBridge = {
  name?: unknown;
  comment?: unknown;
};

export type NamedDnsEntry = {
  name?: unknown;
  comment?: unknown;
};

export function assertPortServiceBridgeIsolated(
  targetBridgeName: string,
  ownerComment: string,
  bridges: NamedBridge[],
): void {
  const existing = bridges.find((bridge) =>
    String(bridge.name ?? "").trim().toLowerCase() === targetBridgeName.trim().toLowerCase(),
  );
  if (existing && String(existing.comment ?? "").trim() !== ownerComment) {
    throw new Error(
      `Bridge "${targetBridgeName}" already exists and is not owned by this isolated port service. Choose a unique bridge name; the normal Hotspot bridge cannot be reused.`,
    );
  }
}

export function assertPortServiceHostnamesIsolated(
  serviceHostnames: Array<string | null | undefined>,
  protectedHostnames: Array<string | null | undefined>,
): void {
  const protectedNames = new Set(
    protectedHostnames.map((name) => String(name ?? "").trim().toLowerCase()).filter(Boolean),
  );
  const collision = serviceHostnames
    .map((name) => String(name ?? "").trim().toLowerCase())
    .find((name) => name && protectedNames.has(name));
  if (collision) {
    throw new Error(
      `Portal hostname "${collision}" is already used by the main Hotspot or portal origin. Give this isolated port a different hostname so it cannot redirect normal Hotspot users.`,
    );
  }
}

export function assertPortServiceDnsEntriesOwned(
  serviceHostnames: Array<string | null | undefined>,
  ownerComments: string[],
  entries: NamedDnsEntry[],
): void {
  const requestedNames = new Set(
    serviceHostnames.map((name) => String(name ?? "").trim().toLowerCase()).filter(Boolean),
  );
  const allowedComments = new Set(ownerComments);
  const collision = entries.find((entry) => {
    const name = String(entry.name ?? "").trim().toLowerCase();
    return requestedNames.has(name) && !allowedComments.has(String(entry.comment ?? "").trim());
  });
  if (collision) {
    throw new Error(
      `RouterOS already has a DNS entry for "${String(collision.name ?? "").trim()}" that belongs to another service. Choose a unique per-port hostname; no router changes were made.`,
    );
  }
}
