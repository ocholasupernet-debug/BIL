export interface ManagedPppoeSetupScriptOptions {
  routerId: number;
  interfaceName: string;
  serviceName: string;
  localAddress?: string;
  removeLegacyBridgeAddress?: boolean;
}

function routerOsQuoted(value: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("PPPoE interface and service names must use RouterOS-safe characters.");
  }
  return `"${value}"`;
}

export function buildManagedPppoeSetupScript({
  routerId,
  interfaceName,
  serviceName,
  localAddress = "192.168.99.1",
  removeLegacyBridgeAddress = false,
}: ManagedPppoeSetupScriptOptions): string {
  if (!Number.isSafeInteger(routerId) || routerId <= 0) {
    throw new Error("A valid router ID is required.");
  }
  const targetInterface = routerOsQuoted(interfaceName);
  const targetService = routerOsQuoted(serviceName);
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(localAddress)) {
    throw new Error("A valid PPPoE local IPv4 address is required.");
  }
  const tag = `ochola-services-${routerId}`;
  const legacyBridgeAddressRemoval = removeLegacyBridgeAddress
    ? `:local legacyPppoeAddress [/ip address find where interface=$pppInterface address="192.168.99.1/24"];
:if ([:len $legacyPppoeAddress] > 0) do={ /ip address remove $legacyPppoeAddress; }
`
    : "";
  const activeAddressCollisionCheck = removeLegacyBridgeAddress
    ? `:local existingActiveAddresses [/ip address find where address~"192.168.99."];
:local removableLegacyAddress [/ip address find where interface=$pppInterface address="192.168.99.1/24"];
:if ([:len $existingActiveAddresses] > [:len $removableLegacyAddress]) do={ :error "192.168.99.0/24 conflicts with another router address; no PPPoE pools were changed"; }
`
    : `:if ([:len [/ip address find where address~"192.168.99."]] > 0) do={ :error "192.168.99.0/24 conflicts with an existing router address; no PPPoE pools were changed"; }
`;

  return `# Managed PPPoE setup for router ${routerId}; scoped to ${interfaceName} and the WAN interface list.
:local pppInterface ${targetInterface};
:local pppLocalAddress "${localAddress}";
:local activePool "${tag}-pppoe-pool";
:local expiredPool "${tag}-pppoe-expired-pool";
:local pppProfile "${tag}-pppoe-profile";
:local pppService ${targetService};
:if ([:len [/ip pool find where name=$activePool]] = 0) do={
  ${activeAddressCollisionCheck}
  :if ([:len [/ip pool find where ranges~"192.168.99."]] > 0) do={ :error "192.168.99.0/24 conflicts with an existing pool; no PPPoE pools were changed"; }
}
:if ([:len [/ip pool find where name=$expiredPool]] = 0) do={
  :if (([:len [/ip address find where address~"192.168.191."]] > 0) || ([:len [/ip pool find where ranges~"192.168.191."]] > 0)) do={ :error "192.168.191.0/24 conflicts with an existing address or pool; no PPPoE pools were changed"; }
}
:if ([:len [/ip pool find where name=$activePool]] = 0) do={ /ip pool add name=$activePool ranges=192.168.99.10-192.168.99.254 comment="${tag} PPPoE pool"; }
:if ([:len [/ip pool find where name=$expiredPool]] = 0) do={ /ip pool add name=$expiredPool ranges=192.168.191.10-192.168.191.254 comment="${tag} PPPoE expired pool"; }
:if ([:len [/ppp profile find where name=$pppProfile]] = 0) do={
  /ppp profile add name=$pppProfile local-address=$pppLocalAddress remote-address=$activePool dns-server=1.1.1.1,8.8.8.8 only-one=yes change-tcp-mss=yes comment="${tag} PPPoE profile";
} else={
  /ppp profile set [find where name=$pppProfile] local-address=$pppLocalAddress remote-address=$activePool dns-server=1.1.1.1,8.8.8.8 only-one=yes change-tcp-mss=yes;
}
:foreach profileId in=[/ppp profile find where remote-address=$activePool] do={ /ppp profile set $profileId local-address=$pppLocalAddress; }
:foreach profileId in=[/ppp profile find where remote-address=$expiredPool] do={ /ppp profile set $profileId local-address=$pppLocalAddress; }
:if ([:len [/interface pppoe-server server find where service-name=$pppService]] = 0) do={
  /interface pppoe-server server add service-name=$pppService interface=$pppInterface default-profile=$pppProfile one-session-per-host=yes disabled=no;
} else={
  /interface pppoe-server server set [find where service-name=$pppService] interface=$pppInterface default-profile=$pppProfile one-session-per-host=yes disabled=no;
}
:local pppForwardComment "${tag} pppoe-to-wan";
:if ([:len [/ip firewall filter find where comment=$pppForwardComment]] = 0) do={
  /ip firewall filter add chain=forward action=accept src-address=192.168.99.0/24 out-interface-list=WAN connection-state=new,established,related comment=$pppForwardComment place-before=0;
}
:local pppNatComment "${tag} PPPoE masquerade";
:if ([:len [/ip firewall nat find where comment=$pppNatComment]] = 0) do={
  /ip firewall nat add chain=srcnat action=masquerade src-address=192.168.99.0/24 out-interface-list=WAN comment=$pppNatComment;
}
${legacyBridgeAddressRemoval}
:put "Ready: PPPoE server, active and expired pools, profile, WAN forwarding, and NAT are configured.";
`;
}
