import { VlanIngressConflictError } from "./port-service-resources.js";

type RouterRow = Record<string, unknown>;

export type TaggedIngressSnapshot = {
  bridges: RouterRow[];
  bridgePorts: RouterRow[];
  bridgeVlans: RouterRow[];
};

export type TaggedIngressPlan = {
  bridgeId: string;
  ingressPortId: string;
  bridgeName: string;
  ingressInterface: string;
  vlanId: number;
  previousFiltering: boolean;
  previousFrameTypes: string;
  previousIngressFiltering: boolean;
  nativePvidPorts: string[];
  staticVlanRows: Array<{
    vlanIds: string;
    tagged: string;
    untagged: string;
  }>;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function flag(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === "boolean") return value;
  const normalized = clean(value).toLowerCase();
  if (["yes", "true", "1"].includes(normalized)) return true;
  if (["no", "false", "0"].includes(normalized)) return false;
  return defaultValue;
}

function interfaceList(value: unknown): string[] {
  return clean(value).split(",").map(item => item.trim()).filter(Boolean);
}

function vlanIdList(value: unknown): string[] {
  return clean(value).split(",").map(item => item.trim()).filter(Boolean);
}

function includesVlanId(value: unknown, vlanId: number): boolean {
  return vlanIdList(value).some(item => {
    if (/^\d+$/.test(item)) return Number(item) === vlanId;
    const range = item.match(/^(\d+)-(\d+)$/);
    return Boolean(range && vlanId >= Number(range[1]) && vlanId <= Number(range[2]));
  });
}

function isDynamic(row: RouterRow): boolean {
  return flag(row.dynamic, false);
}

function rowFrameTypes(row: RouterRow): string {
  return clean(row["frame-types"]) || "admit-all";
}

function rowPvid(row: RouterRow): string {
  return clean(row.pvid) || "1";
}

function isDisabled(row: RouterRow): boolean {
  return flag(row.disabled, false);
}

function requireTaggedVlanRow(
  rows: RouterRow[],
  bridgeName: string,
  ingressInterface: string,
  vlanId: number,
): RouterRow {
  const matches = rows.filter(row =>
    clean(row.bridge) === bridgeName
    && includesVlanId(row["vlan-ids"], vlanId)
    && !isDynamic(row),
  );
  if (matches.length !== 1) {
    throw new VlanIngressConflictError(
      matches.length
        ? `VLAN ${vlanId} matches multiple bridge VLAN rules; no RouterOS settings were changed.`
        : `VLAN ${vlanId} has no static bridge VLAN rule; no RouterOS settings were changed.`,
    );
  }
  const row = matches[0];
  const vlanIds = vlanIdList(row["vlan-ids"]);
  if (vlanIds.length !== 1 || vlanIds[0] !== String(vlanId)) {
    throw new VlanIngressConflictError(
      `VLAN ${vlanId} shares a bridge VLAN rule with other IDs; split that rule before enabling filtering.`,
    );
  }
  const tagged = interfaceList(row.tagged);
  const untagged = interfaceList(row.untagged);
  if (!tagged.includes(bridgeName) || !tagged.includes(ingressInterface) || untagged.includes(ingressInterface)) {
    throw new VlanIngressConflictError(
      `VLAN ${vlanId} must list both ${bridgeName} and ${ingressInterface} as tagged members, with no untagged ingress membership.`,
    );
  }
  return row;
}

export function planTaggedVlanIngressEnforcement(input: {
  bridgeName: string;
  ingressInterface: string;
  vlanId: number;
  snapshot: TaggedIngressSnapshot;
}): TaggedIngressPlan {
  const bridgeMatches = input.snapshot.bridges.filter(row => clean(row.name) === input.bridgeName);
  if (bridgeMatches.length !== 1 || !clean(bridgeMatches[0][".id"])) {
    throw new VlanIngressConflictError(
      `Bridge ${input.bridgeName} is missing or has no RouterOS identity; no settings were changed.`,
    );
  }
  const bridge = bridgeMatches[0];
  const bridgePvid = rowPvid(bridge);
  if (bridgePvid !== "1" || rowFrameTypes(bridge) === "admit-only-vlan-tagged") {
    throw new VlanIngressConflictError(
      `Bridge ${input.bridgeName} does not preserve the expected native VLAN 1; review its CPU-port settings before enabling filtering.`,
    );
  }

  const activePorts = input.snapshot.bridgePorts.filter(row =>
    clean(row.bridge) === input.bridgeName && !isDisabled(row),
  );
  const ingressMatches = activePorts.filter(row => clean(row.interface) === input.ingressInterface);
  if (ingressMatches.length !== 1 || !clean(ingressMatches[0][".id"])) {
    throw new VlanIngressConflictError(
      `Ingress ${input.ingressInterface} is missing, duplicated, disabled, or has no RouterOS identity.`,
    );
  }
  const ingress = ingressMatches[0];
  const nativePvidPorts = activePorts
    .filter(row => clean(row.interface) !== input.ingressInterface)
    .map(row => {
      const name = clean(row.interface);
      if (!name || rowPvid(row) !== "1" || rowFrameTypes(row) === "admit-only-vlan-tagged") {
        throw new VlanIngressConflictError(
          `Bridge port ${name || "(unnamed)"} is not a verified native VLAN 1 port; no filtering changes were made.`,
        );
      }
      return name;
    });

  const staticRows = input.snapshot.bridgeVlans.filter(row =>
    clean(row.bridge) === input.bridgeName && !isDynamic(row),
  );
  const target = requireTaggedVlanRow(
    staticRows,
    input.bridgeName,
    input.ingressInterface,
    input.vlanId,
  );
  for (const row of staticRows) {
    const vlanIds = vlanIdList(row["vlan-ids"]);
    const untagged = interfaceList(row.untagged);
    if (vlanIds.includes("1")) {
      if (
        untagged.includes(input.ingressInterface)
        || !untagged.includes(input.bridgeName)
        || nativePvidPorts.some(name => !untagged.includes(name))
      ) {
        throw new VlanIngressConflictError(
          "The explicit native VLAN 1 membership does not preserve the bridge and its native ports; no settings were changed.",
        );
      }
      if (interfaceList(row.tagged).includes(input.ingressInterface)) {
        throw new VlanIngressConflictError(
          "The ingress is explicitly a tagged member of native VLAN 1; review this trunk membership before enabling filtering.",
        );
      }
    } else if (untagged.length) {
      throw new VlanIngressConflictError(
        `Bridge VLAN ${vlanIds.join(",") || "(unknown)"} has explicit untagged members; review the shared bridge before enabling filtering.`,
      );
    }
    const members = [...interfaceList(row.tagged), ...untagged];
    const knownInterfaces = new Set([
      input.bridgeName,
      ...activePorts.map(port => clean(port.interface)).filter(Boolean),
    ]);
    const unknownMember = members.find(member => !knownInterfaces.has(member));
    if (unknownMember) {
      throw new VlanIngressConflictError(
        `Bridge VLAN membership includes unknown interface ${unknownMember}; no filtering changes were made.`,
      );
    }
  }

  requireTaggedVlanRow(staticRows, input.bridgeName, input.ingressInterface, input.vlanId);
  return {
    bridgeId: clean(bridge[".id"]),
    ingressPortId: clean(ingress[".id"]),
    bridgeName: input.bridgeName,
    ingressInterface: input.ingressInterface,
    vlanId: input.vlanId,
    previousFiltering: flag(bridge["vlan-filtering"], false),
    previousFrameTypes: rowFrameTypes(ingress),
    previousIngressFiltering: flag(ingress["ingress-filtering"], true),
    nativePvidPorts,
    staticVlanRows: staticRows.map(row => ({
      vlanIds: clean(row["vlan-ids"]),
      tagged: interfaceList(row.tagged).sort().join(","),
      untagged: interfaceList(row.untagged).sort().join(","),
    })),
  };
}

function findBridge(snapshot: TaggedIngressSnapshot, bridgeName: string): RouterRow | undefined {
  return snapshot.bridges.find(row => clean(row.name) === bridgeName);
}

function findIngressPort(
  snapshot: TaggedIngressSnapshot,
  bridgeName: string,
  ingressInterface: string,
): RouterRow | undefined {
  return snapshot.bridgePorts.find(row =>
    clean(row.bridge) === bridgeName
    && clean(row.interface) === ingressInterface
    && !isDisabled(row),
  );
}

function validatePostChange(input: {
  snapshot: TaggedIngressSnapshot;
  plan: TaggedIngressPlan;
}): void {
  const { snapshot, plan } = input;
  const bridge = findBridge(snapshot, plan.bridgeName);
  const ingress = findIngressPort(snapshot, plan.bridgeName, plan.ingressInterface);
  if (
    !bridge
    || !flag(bridge["vlan-filtering"], false)
    || !ingress
    || rowFrameTypes(ingress) !== "admit-only-vlan-tagged"
    || !flag(ingress["ingress-filtering"], false)
  ) {
    throw new Error("RouterOS did not report the required tagged-only bridge settings after the update.");
  }
  const target = requireTaggedVlanRow(
    snapshot.bridgeVlans,
    plan.bridgeName,
    plan.ingressInterface,
    plan.vlanId,
  );
  const targetSummary = {
    vlanIds: clean(target["vlan-ids"]),
    tagged: interfaceList(target.tagged).sort().join(","),
    untagged: interfaceList(target.untagged).sort().join(","),
  };
  if (!plan.staticVlanRows.some(row =>
    row.vlanIds === targetSummary.vlanIds
    && row.tagged === targetSummary.tagged
    && row.untagged === targetSummary.untagged,
  )) {
    throw new Error(`VLAN ${plan.vlanId} membership changed unexpectedly during the update.`);
  }

  const nativeRows = snapshot.bridgeVlans.filter(row =>
    clean(row.bridge) === plan.bridgeName && includesVlanId(row["vlan-ids"], 1),
  );
  const nativeMembers = new Set(
    nativeRows.flatMap(row => interfaceList(row["current-untagged"] ?? row.untagged)),
  );
  if (
    nativeRows.length === 0
    || nativeMembers.has(plan.ingressInterface)
    || !nativeMembers.has(plan.bridgeName)
    || plan.nativePvidPorts.some(name => !nativeMembers.has(name))
  ) {
    throw new Error("RouterOS did not verify native VLAN 1 on the bridge and its existing ports.");
  }
}

export async function enforceTaggedVlanIngress(input: {
  bridgeName: string;
  ingressInterface: string;
  vlanId: number;
  readState: () => Promise<TaggedIngressSnapshot>;
  writeRouterCommand: (command: string[]) => Promise<unknown>;
  assertLock?: () => Promise<void>;
}): Promise<{
  changed: boolean;
  bridge: string;
  ingressInterface: string;
  vlanId: number;
  vlanFiltering: true;
  frameTypes: "admit-only-vlan-tagged";
  ingressFiltering: true;
  nativePvidPorts: string[];
  taggedVlans: string[];
}> {
  const assertLock = input.assertLock ?? (async () => undefined);
  const before = await input.readState();
  const plan = planTaggedVlanIngressEnforcement({
    bridgeName: input.bridgeName,
    ingressInterface: input.ingressInterface,
    vlanId: input.vlanId,
    snapshot: before,
  });
  const ingressAlreadyStrict = plan.previousFrameTypes === "admit-only-vlan-tagged"
    && plan.previousIngressFiltering;
  if (plan.previousFiltering && ingressAlreadyStrict) {
    validatePostChange({ snapshot: before, plan });
    return {
      changed: false,
      bridge: plan.bridgeName,
      ingressInterface: plan.ingressInterface,
      vlanId: plan.vlanId,
      vlanFiltering: true,
      frameTypes: "admit-only-vlan-tagged",
      ingressFiltering: true,
      nativePvidPorts: plan.nativePvidPorts,
      taggedVlans: plan.staticVlanRows.map(row => row.vlanIds).sort(),
    };
  }

  let mutationStarted = false;
  try {
    if (!ingressAlreadyStrict) {
      await assertLock();
      mutationStarted = true;
      await input.writeRouterCommand([
        "/interface/bridge/port/set",
        `=.id=${plan.ingressPortId}`,
        "=frame-types=admit-only-vlan-tagged",
        "=ingress-filtering=yes",
      ]);
    }
    if (!plan.previousFiltering) {
      await assertLock();
      mutationStarted = true;
      await input.writeRouterCommand([
        "/interface/bridge/set",
        `=.id=${plan.bridgeId}`,
        "=vlan-filtering=yes",
      ]);
    }
    await assertLock();
    const after = await input.readState();
    validatePostChange({ snapshot: after, plan });
    return {
      changed: true,
      bridge: plan.bridgeName,
      ingressInterface: plan.ingressInterface,
      vlanId: plan.vlanId,
      vlanFiltering: true,
      frameTypes: "admit-only-vlan-tagged",
      ingressFiltering: true,
      nativePvidPorts: plan.nativePvidPorts,
      taggedVlans: plan.staticVlanRows.map(row => row.vlanIds).sort(),
    };
  } catch (error) {
    if (!mutationStarted) throw error;
    const rollbackErrors: string[] = [];
    try {
      await assertLock();
      if (!plan.previousFiltering) {
        await input.writeRouterCommand([
          "/interface/bridge/set",
          `=.id=${plan.bridgeId}`,
          "=vlan-filtering=no",
        ]);
      }
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : "Bridge filtering rollback failed.");
    }
    try {
      await assertLock();
      await input.writeRouterCommand([
        "/interface/bridge/port/set",
        `=.id=${plan.ingressPortId}`,
        `=frame-types=${plan.previousFrameTypes}`,
        `=ingress-filtering=${plan.previousIngressFiltering ? "yes" : "no"}`,
      ]);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : "Ingress port rollback failed.");
    }
    const originalMessage = error instanceof Error ? error.message : "RouterOS rejected the tagged ingress update.";
    const rollbackMessage = rollbackErrors.length
      ? ` Rollback was incomplete: ${rollbackErrors.join(" ")}`
      : " Previous bridge and ingress settings were restored.";
    throw new VlanIngressConflictError(
      `Tagged VLAN ingress enforcement failed verification: ${originalMessage}.${rollbackMessage}`,
    );
  }
}