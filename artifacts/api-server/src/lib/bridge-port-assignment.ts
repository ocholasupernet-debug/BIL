export interface BridgePortAssignmentMembership {
  interface: string;
  bridge: string;
  id: string;
}

export type BridgePortAdditionPlan =
  | { action: "add" }
  | { action: "skip" }
  | { action: "move"; fromBridge: string; portId: string };

export function planBridgePortAddition(
  interfaceName: string,
  targetBridge: string,
  memberships: readonly BridgePortAssignmentMembership[],
  confirmedSourceBridge?: string,
): BridgePortAdditionPlan {
  const current = memberships.filter(row => row.interface === interfaceName);
  if (current.length > 1) {
    throw new Error(`${interfaceName} has more than one bridge-port entry; refusing an ambiguous move.`);
  }

  const existing = current[0];
  if (!existing) {
    if (confirmedSourceBridge) {
      throw new Error(`The live membership for ${interfaceName} changed since confirmation; refresh and confirm the move again.`);
    }
    return { action: "add" };
  }

  if (existing.bridge === targetBridge) return { action: "skip" };
  if (!confirmedSourceBridge || confirmedSourceBridge !== existing.bridge) {
    throw new Error(`${interfaceName} is currently in ${existing.bridge}; refresh and explicitly confirm moving it before reassignment.`);
  }
  if (!existing.id) {
    throw new Error(`RouterOS did not return a bridge-port ID for ${interfaceName}; refusing to remove it.`);
  }
  return { action: "move", fromBridge: existing.bridge, portId: existing.id };
}
