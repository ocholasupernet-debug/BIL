export interface VlanHotspotServerInput {
  name: string;
  interfaceName: string;
  profile: string;
  addressPool: string;
}

/**
 * Keep the stable server name as identity; the target RouterOS HotSpot server
 * API rejects comment on set operations.
 */
export function buildVlanHotspotServerConfig(input: VlanHotspotServerInput): {
  addCommand: string[];
  expectedProperties: Record<string, string>;
} {
  const expectedProperties = {
    interface: input.interfaceName,
    profile: input.profile,
    "address-pool": input.addressPool,
    disabled: "no",
  };

  return {
    addCommand: [
      "/ip/hotspot/add",
      `=name=${input.name}`,
      `=interface=${input.interfaceName}`,
      `=profile=${input.profile}`,
      `=address-pool=${input.addressPool}`,
      "=disabled=no",
    ],
    expectedProperties,
  };
}