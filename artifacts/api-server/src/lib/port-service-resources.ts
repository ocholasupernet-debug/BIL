export type PortServiceResourceInput = {
  id: number;
  router_id: number;
  interface_name: string;
  bridge_name?: string | null;
  handoff_mode?: "services" | "isp_router" | "vlan_services" | null;
  reseller_id?: number | null;
  assigned_reseller_id?: number | null;
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
  pppoePool: string;
  hotspotServer: string;
  hotspotProfile: string;
  hotspotDhcp: string;
  pppoeService: string;
  pppoeProfile: string;
  parentQueue: string;
  commentPrefix: string;
};

export type PlanServiceType = "hotspot" | "trials" | "pppoe" | string;

/**
 * Plans use the pool owned by their scoped service. A plan must not create a
 * second range inside the VLAN subnet: the service pool is already the
 * authoritative DHCP/PPPoE allocation range for that port.
 */
export function planServicePoolName(
  planType: PlanServiceType,
  resources?: Pick<PortServiceResourceNames, "hotspotPool" | "pppoePool">,
): string | null {
  const type = String(planType ?? "hotspot").trim().toLowerCase();
  if (type === "pppoe") return resources?.pppoePool ?? "pppoe";
  if (type === "hotspot" || type === "trials" || type === "trial") {
    return resources?.hotspotPool ?? "hotspot pool";
  }
  return null;
}

function resourceSegment(value: string, fallback: string, maxLength = 24): string {
  const result = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return result.slice(0, maxLength) || fallback;
}

export function vlanServicePoolRanges(subnetRange: string | null | undefined): {
  hotspot: string;
  pppoe: string;
} {
  const octets = String(subnetRange ?? "").split("/")[0]?.split(".").map(Number) ?? [];
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    throw new Error("A VLAN service requires a valid private /24 network before its IP pools can be configured.");
  }
  const prefix = octets.slice(0, 3).join(".");
  return {
    hotspot: `${prefix}.10-${prefix}.199`,
    pppoe: `${prefix}.200-${prefix}.254`,
  };
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
  const ownerId = port.assigned_reseller_id ?? port.reseller_id;
  if (port.handoff_mode === "vlan_services" && ownerId && port.vlan_tag) {
    const segment = `RS${ownerId}_VLAN${port.vlan_tag}`
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .slice(0, 48);
    return {
      identity,
      portName,
      resourceName: segment,
      defaultDnsName: `${dnsLabel}.com`,
      assetKey,
      /* All VLAN services on one MikroTik intentionally point to one portal
         directory. Their Hotspot/PPPoE servers and profiles remain unique. */
      hotspotDirectory: `flash/hotspot/ochola_shared_r${port.router_id}`,
      pppoeDirectory: `flash/hotspot/ochola_shared_r${port.router_id}`,
      bridgeName,
      hotspotPool: `HS_POOL_${segment}`,
      pppoePool: `PPPOE_POOL_${segment}`,
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
    pppoePool: `PPPOE_POOL_${resourceName}`,
    hotspotServer: `HS_${resourceName}`,
    hotspotProfile: `HS_PROFILE_${resourceName}`,
    hotspotDhcp: `HS_DHCP_${resourceName}`,
    pppoeService: `PPPoE_${resourceName}`,
    pppoeProfile: `PPPOE_ALERT_${resourceName}`,
    parentQueue: `SERVICE_ROOT_${resourceName}`,
    commentPrefix: `${resourceName}_service`,
  };
}