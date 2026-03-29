/**
 * vpn-status.ts
 * Reads the OpenVPN server status file to discover connected clients
 * and their VPN tunnel IPs (10.8.0.x).
 *
 * Used by all MikroTik API route handlers to automatically fall back
 * to the VPN tunnel IP when a router's WAN/LAN IP is unreachable.
 */
import { readFileSync } from "fs";

const STATUS_PATHS = [
  "/etc/openvpn/openvpn-status.log",
  "/etc/openvpn/server/openvpn-status.log",
  "/var/log/openvpn/openvpn-status.log",
  "/tmp/openvpn-status.log",
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

      if (clients.length > 0) {
        console.log(`[vpn-status] ${clients.length} client(s) from ${path}:`,
          clients.map(c => `${c.cn}=${c.vpnIp}(${c.realIp})`).join(", "));
        return clients;
      }
    } catch { /* file not found or unreadable — try next path */ }
  }
  return [];
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

/**
 * Returns all paths that will be checked for the OpenVPN status file.
 * Useful for diagnostics endpoints.
 */
export { STATUS_PATHS as VPN_STATUS_PATHS };
