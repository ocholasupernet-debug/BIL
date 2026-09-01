/**
 * vpn-status.ts
 * Reads the OpenVPN server status file to discover connected clients
 * and their VPN tunnel IPs.
 *
 * Used by all MikroTik API route handlers to automatically fall back
 * to the VPN tunnel IP when a router's WAN/LAN IP is unreachable.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { ROUTER_MANAGEMENT_VPN, ROUTER_MANAGEMENT_VPN_BACKUP } from "./router-management-vpn.js";

const STATUS_PATHS = [
  ROUTER_MANAGEMENT_VPN.statusPath,
  ROUTER_MANAGEMENT_VPN_BACKUP.statusPath,
  "/etc/openvpn/openvpn-status.log",
  "/etc/openvpn/server/openvpn-status.log",
  "/var/log/openvpn/openvpn-status.log",
  "/tmp/openvpn-status.log",
];

const IPP_PATHS = [
  ROUTER_MANAGEMENT_VPN.ippPath,
  ROUTER_MANAGEMENT_VPN_BACKUP.ippPath,
  "/etc/openvpn/server/ipp.txt",
  "/etc/openvpn/ipp.txt",
  "/var/log/openvpn/ipp.txt",
  "/tmp/openvpn-ipp.txt",
];

export interface VpnClient {
  /** Certificate Common Name (usually the router name) */
  cn:     string;
  /** VPN tunnel IP assigned by the server, e.g. 10.8.0.6 */
  vpnIp:  string;
  /** Router's real (WAN) IP seen by the server */
  realIp: string;
}

/**
 * Reads the first accessible OpenVPN status file and returns
 * the list of currently connected clients.
 * Returns an empty array if no file is found or no clients are connected.
 */
export function readVpnClients(): VpnClient[] {
  const clientsByName = new Map<string, VpnClient>();
  for (const path of STATUS_PATHS) {
    try {
      const text = readFileSync(path, "utf-8");
      const clients: VpnClient[] = [];
      let inRouting = false;

      for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("END")) break;
        if (line.startsWith("ROUTING TABLE")) { inRouting = true; continue; }
        if (inRouting && line.startsWith("Virtual Address")) continue; /* header row */
        if (!inRouting) continue;

        /* Routing table row format: vpnIp,cn,realIp:port,lastRef */
        const parts = line.split(",");
        if (parts.length < 3) continue;
        const vpnIp    = parts[0].trim();
        const cn       = parts[1].trim();
        const realFull = parts[2].trim();          /* e.g. 129.222.147.23:PORT */
        const realIp   = realFull.split(":")[0];

        if (vpnIp && cn && /^10\./.test(vpnIp)) {
          clients.push({ cn, vpnIp, realIp });
        }
      }

      for (const client of clients) clientsByName.set(client.cn, client);
    } catch { /* file not found or unreadable — try next path */ }
  }
  const clients = [...clientsByName.values()];
  if (clients.length > 0) {
    console.log("[vpn-status] clients:",
      clients.map(c => `${c.cn}=${c.vpnIp}(${c.realIp})`).join(", "));
  }
  return clients;
}

/**
 * Returns the VPN tunnel IP for a given WAN IP or CN, or null if not found.
 * Matches by realIp first, then by cn (certificate common name).
 */
export function vpnIpFor(hostOrCn: string, clients: VpnClient[]): string | null {
  for (const c of clients) {
    if (c.realIp === hostOrCn || c.cn === hostOrCn) return c.vpnIp;
  }
  return null;
}

/** Read OpenVPN's persistent client-name → tunnel-IP assignments. */
export function readIppEntries(): Map<string, string> {
  const map = new Map<string, string>();
  for (const path of IPP_PATHS) {
    if (!existsSync(path)) continue;
    try {
      for (const line of readFileSync(path, "utf-8").split("\n")) {
        const [name, ip] = line.trim().split(",");
        if (name && ip && /^10\./.test(ip.trim())) map.set(name.trim(), ip.trim());
      }
    } catch {
      /* Try the next known OpenVPN persistence file. */
    }
  }
  return map;
}

/**
 * Persist a connected client in OpenVPN's simple ipp.txt-compatible format.
 * This is called only after the server status file and an authenticated
 * router heartbeat/registration have identified the same client.
 */
export function syncIppEntry(clientName: string, ip: string): boolean {
  const name = clientName.trim();
  const address = ip.trim();
  if (!name || !/^10\./.test(address)) return false;
  try {
    const managementPaths: string[] = [ROUTER_MANAGEMENT_VPN.ippPath, ROUTER_MANAGEMENT_VPN_BACKUP.ippPath];
    const legacyPaths = IPP_PATHS.filter(candidate => !managementPaths.includes(candidate));
    const managementPath = address.startsWith(`${ROUTER_MANAGEMENT_VPN.tunnelBase}.`)
      ? ROUTER_MANAGEMENT_VPN.ippPath
      : address.startsWith(`${ROUTER_MANAGEMENT_VPN_BACKUP.tunnelBase}.`)
        ? ROUTER_MANAGEMENT_VPN_BACKUP.ippPath
        : null;
    const path = managementPath ?? legacyPaths.find(candidate => existsSync(candidate)) ?? legacyPaths[0];
    const content = existsSync(path) ? readFileSync(path, "utf-8") : "";
    const lines = content
      .split("\n")
      .filter(line => line.trim() && !line.trim().startsWith(`${name},`));
    lines.push(`${name},${address}`);
    writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
    return true;
  } catch {
    /* Local development cannot write /etc/openvpn; the VPS can. */
    return false;
  }
}

/**
 * Returns all paths that will be checked for the OpenVPN status file.
 * Useful for diagnostics endpoints.
 */
export { STATUS_PATHS as VPN_STATUS_PATHS };
export { IPP_PATHS as VPN_IPP_PATHS };
