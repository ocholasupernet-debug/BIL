/**
 * Persistent management addresses for MikroTik OpenVPN clients.
 *
 * This pool is intentionally separate from the legacy end-user VPN pool.
 * Router management addresses are stable for the lifetime of a router record
 * and are also written to OpenVPN's ipp.txt after the router is observed
 * connected.
 */
export const ROUTER_VPN_SUBNET = "10.8.5";
export const ROUTER_VPN_GATEWAY = `${ROUTER_VPN_SUBNET}.1`;

export function isRouterVpnIp(value: string | null | undefined): boolean {
  return new RegExp(`^${ROUTER_VPN_SUBNET}\\.([2-9]|[1-9]\\d|1\\d\\d|2[0-4]\\d|25[0-4])$`).test(
    (value ?? "").trim(),
  );
}

/**
 * Pick a free client address. The first address is deliberately not tied to
 * a router ID so deleted records do not permanently consume the pool.
 */
export function allocateRouterVpnIp(usedIps: Iterable<string>): string {
  const used = new Set(Array.from(usedIps, ip => ip.trim()));
  used.add(ROUTER_VPN_GATEWAY);
  for (let host = 2; host <= 254; host += 1) {
    const candidate = `${ROUTER_VPN_SUBNET}.${host}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`Router management VPN pool exhausted (${ROUTER_VPN_SUBNET}.0/24).`);
}