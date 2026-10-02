export interface BridgePortMembershipComparison {
  matches: boolean;
  missing: string[];
  unexpected: string[];
}

export function compareBridgePortMembership(
  actualPorts: Iterable<string>,
  desiredPorts: Iterable<string>,
): BridgePortMembershipComparison {
  const actual = new Set(actualPorts);
  const desired = new Set(desiredPorts);
  const missing = [...desired].filter(port => !actual.has(port));
  const unexpected = [...actual].filter(port => !desired.has(port));

  return {
    matches: missing.length === 0 && unexpected.length === 0,
    missing,
    unexpected,
  };
}