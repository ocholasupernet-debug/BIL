export interface VlanHotspotProfileInput {
  name: string;
  gateway: string;
  htmlDirectory: string;
  dnsName: string;
}

/**
 * RouterOS HotSpot profiles do not accept a comment property. Use the stable
 * profile name for identity and reconcile only supported profile fields.
 */
export function buildVlanHotspotProfileConfig(input: VlanHotspotProfileInput): {
  addCommand: string[];
  expectedProperties: Record<string, string>;
} {
  const expectedProperties = {
    "hotspot-address": input.gateway,
    "html-directory": input.htmlDirectory,
    "dns-name": input.dnsName,
    "login-by": "http-chap,http-pap,cookie",
  };

  return {
    addCommand: [
      "/ip/hotspot/profile/add",
      `=name=${input.name}`,
      `=hotspot-address=${input.gateway}`,
      `=html-directory=${input.htmlDirectory}`,
      `=dns-name=${input.dnsName}`,
      `=login-by=${expectedProperties["login-by"]}`,
    ],
    expectedProperties,
  };
}