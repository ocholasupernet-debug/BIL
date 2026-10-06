export interface PortServiceBridgeMembership {
  interfaceName: string;
  bridgePortId: string;
  bridgeReference: string;
  bridgeName: string;
}

export interface RouterOSBridgeRow {
  id?: string;
  name?: string;
}

export type PortServiceBridgeAdditionPlan =
  | { action: "add" }
  | { action: "skip" }
  | {
      action: "move";
      portId: string;
      fromBridgeReference: string;
      fromBridgeName: string;
    };

export class BridgeMoveConfirmationRequiredError extends Error {
  readonly code = "BRIDGE_MOVE_CONFIRMATION_REQUIRED";

  constructor(
    readonly interfaceName: string,
    readonly sourceBridgeReference: string,
    readonly sourceBridgeName: string,
    readonly targetBridgeName: string,
  ) {
    super(
      `Interface ${interfaceName} is currently in bridge "${sourceBridgeName}". Confirm moving it to "${targetBridgeName}"; this may interrupt existing service.`,
    );
    this.name = "BridgeMoveConfirmationRequiredError";
  }
}

export function resolvePortServiceBridgeName(
  bridgeReference: string,
  bridges: readonly RouterOSBridgeRow[],
): string | null {
  const bridge = bridges.find((row) =>
    row.id === bridgeReference || row.name === bridgeReference,
  );
  return bridge?.name?.trim() || null;
}

export function planPortServiceBridgeAddition(
  interfaceName: string,
  targetBridgeName: string,
  memberships: readonly PortServiceBridgeMembership[],
  confirmedSourceBridgeReference?: string,
): PortServiceBridgeAdditionPlan {
  const current = memberships.filter((row) => row.interfaceName === interfaceName);
  if (current.length > 1) {
    throw new Error(`${interfaceName} has multiple bridge-port entries; refusing an ambiguous move.`);
  }

  const existing = current[0];
  if (!existing) return { action: "add" };
  if (existing.bridgeName === targetBridgeName) return { action: "skip" };
  if (!existing.bridgePortId || !existing.bridgeReference || !existing.bridgeName) {
    throw new Error(`RouterOS returned incomplete bridge membership for ${interfaceName}; refusing to remove it.`);
  }
  if (confirmedSourceBridgeReference !== existing.bridgeReference) {
    throw new BridgeMoveConfirmationRequiredError(
      interfaceName,
      existing.bridgeReference,
      existing.bridgeName,
      targetBridgeName,
    );
  }

  return {
    action: "move",
    portId: existing.bridgePortId,
    fromBridgeReference: existing.bridgeReference,
    fromBridgeName: existing.bridgeName,
  };
}
