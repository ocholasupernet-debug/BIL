export type PortServiceResourceInput = {
  id: number;
  router_id: number;
  interface_name: string;
  bridge_name?: string | null;
  handoff_mode?: "services" | "isp_router" | "vlan_services" | null;
  reseller_id?: number | null;
  vlan_tag?: string | null;
};

export type PortServiceResourceOptions = {
  companyName?: string | null;
  routerName?: string | null;
};

export type PortServiceResourceNames = {
  identity: string;
  portName: string;
  resourceName: string;
  defaultDnsName: string;
  assetKey: string;
  hotspotDirectory: string;
  pppoeDirectory: string;
  bridgeName: string;
  hotspotPool: string;
  hotspotServer: string;
  hotspotProfile: string;
  hotspotDhcp: string;
  pppoeService: string;
  pppoeProfile: string;
  parentQueue: string;
  commentPrefix: string;
};

function resourceSegment(value: string, fallback: string, maxLength = 24): string {
  const result = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return result.slice(0, maxLength) || fallback;
}

export function portServiceResourceNames(
  port: PortServiceResourceInput,
  options: PortServiceResourceOptions = {},
): PortServiceResourceNames {
  const company = resourceSegment(options.companyName ?? "", "", 18);
  const router = resourceSegment(options.routerName ?? "", `router-${port.router_id}`, 18);
  const identity = resourceSegment([company, router].filter(Boolean).join("-"), router, 28);
  const portName = resourceSegment(port.interface_name, `port-${port.id}`, 18);
  const resourceName = resourceSegment(`${identity}-${portName}`, `router-${port.router_id}-${portName}`, 42);
  const dnsLabel = company || router;
  const assetKey = resourceSegment(`p${port.id}-${portName}`, `port-${port.id}`, 32);
  const explicitBridge = (port.bridge_name ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  const bridgeName = explicitBridge || `${resourceName}-bridge`;
  if (port.handoff_mode === "vlan_services" && port.reseller_id && port.vlan_tag) {
    const segment = `RS${port.reseller_id}_VLAN${port.vlan_tag}`
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .slice(0, 48);
    return {
      identity,
      portName,
      resourceName: segment,
      defaultDnsName: `${dnsLabel}.com`,
      assetKey,
      hotspotDirectory: `flash/hotspot/hs_${assetKey}`,
      pppoeDirectory: `flash/hotspot/pppoe_${assetKey}`,
      bridgeName,
      hotspotPool: `HS_POOL_${segment}`,
      hotspotServer: `HS_${segment}`,
      hotspotProfile: `HS_PROFILE_${segment}`,
      hotspotDhcp: `HS_DHCP_${segment}`,
      pppoeService: `PPPoE_${segment}`,
      pppoeProfile: `PPPOE_PROFILE_${segment}`,
      parentQueue: `RESELLER_ROOT_${segment}`,
      commentPrefix: `OcholaSupernet_${segment}`,
    };
  }

  return {
    identity,
    portName,
    resourceName,
    defaultDnsName: `${dnsLabel}.com`,
    assetKey,
    hotspotDirectory: `flash/hotspot/hs_${assetKey}`,
    pppoeDirectory: `flash/hotspot/pppoe_${assetKey}`,
    bridgeName,
    hotspotPool: `HS_POOL_${resourceName}`,
    hotspotServer: `HS_${resourceName}`,
    hotspotProfile: `HS_PROFILE_${resourceName}`,
    hotspotDhcp: `HS_DHCP_${resourceName}`,
    pppoeService: `PPPoE_${resourceName}`,
    pppoeProfile: `PPPOE_ALERT_${resourceName}`,
    parentQueue: `SERVICE_ROOT_${resourceName}`,
    commentPrefix: `${resourceName}_service`,
  };
}