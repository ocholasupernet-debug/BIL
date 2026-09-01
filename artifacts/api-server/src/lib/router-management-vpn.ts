import { existsSync } from "fs";

/**
 * Single source of truth for the isolated router-management VPN.
 *
 * Legacy customer OpenVPN services deliberately do not use these values:
 * customer traffic remains on 1194, while proxy/backup traffic remains on
 * 1195. Only the persistent MikroTik management tunnel uses this contract.
 */
export const ROUTER_MANAGEMENT_VPN = {
  port: 1196,
  publicPortBase: 11960,
  protocol: "tcp",
  tunnelBase: "10.8.5",
  network: "10.8.5.0/24",
  gateway: "10.8.5.1",
  interfaceName: "tun-router",
  configPath: "/etc/openvpn/server/ochola-router.conf",
  authFilePath: "/etc/openvpn/router-passwd",
  authScriptPath: "/etc/openvpn/verify-router-pass.sh",
  ccdPath: "/etc/openvpn/server/ochola-router-ccd",
  statusPath: "/var/log/openvpn/ochola-router-status.log",
  ippPath: "/etc/openvpn/router-ipp.txt",
  easyRsaPath: "/etc/openvpn/easy-rsa/easyrsa",
  caPaths: [
    "/etc/openvpn/easy-rsa/pki/ca.crt",
    "/etc/openvpn/ca.crt",
  ],
} as const;

/** Isolated OpenVPN backup for router management. The legacy end-user proxy
 * service on TCP 1195 / 10.9.0.0/24 is intentionally not reused. */
export const ROUTER_MANAGEMENT_VPN_BACKUP = {
  port: 1197,
  protocol: "tcp",
  tunnelBase: "10.8.6",
  network: "10.8.6.0/24",
  gateway: "10.8.6.1",
  interfaceName: "tun-router-backup",
  configPath: "/etc/openvpn/server/ochola-router-backup.conf",
  authFilePath: "/etc/openvpn/router-backup-passwd",
  authScriptPath: "/etc/openvpn/verify-router-backup-pass.sh",
  ccdPath: "/etc/openvpn/server/ochola-router-backup-ccd",
  statusPath: "/var/log/openvpn/ochola-router-backup-status.log",
  ippPath: "/etc/openvpn/router-backup-ipp.txt",
  easyRsaPath: "/etc/openvpn/easy-rsa/easyrsa",
  caPaths: [
    "/etc/openvpn/easy-rsa/pki/ca.crt",
    "/etc/openvpn/ca.crt",
  ],
} as const;

export type RouterManagementVpnRole = "primary" | "backup";

export function routerManagementVpnContract(role: RouterManagementVpnRole = "primary") {
  return role === "backup" ? ROUTER_MANAGEMENT_VPN_BACKUP : ROUTER_MANAGEMENT_VPN;
}

/** Map a primary management address to the same router's backup address. */
export function routerManagementBackupIp(primaryIp: string): string {
  const match = /^10\.8\.5\.(\d+)$/.exec(String(primaryIp ?? "").trim());
  const host = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(host) || host < 2 || host > 254) {
    throw new Error(`Router management address cannot map to the backup pool: ${primaryIp}`);
  }
  return `10.8.6.${host}`;
}

export interface RouterManagementOvpnCredentials {
  username: string;
  password: string;
}

/**
 * Keep the configured router name as the one OpenVPN identity used by the
 * MikroTik client, VPS password file, CCD entry, and live status matching.
 *
 * OpenVPN's auth file uses ":" as a delimiter and the username is also used
 * as a CCD filename, so reject unsafe names instead of silently changing them.
 */
export function routerManagementOvpnCredentials(routerName: string): RouterManagementOvpnCredentials {
  const username = String(routerName ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(username)) {
    throw new Error(
      "Router name must be 1-63 characters and contain only letters, numbers, dot, underscore, or hyphen for OpenVPN.",
    );
  }
  return {
    username,
    password: username,
  };
}

export function routerManagementVpnPort(): number {
  const raw = process.env.ROUTER_OPENVPN_PORT?.trim();
  if (!raw) return ROUTER_MANAGEMENT_VPN.port;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("ROUTER_OPENVPN_PORT must be an integer between 1 and 65535");
  }
  return port;
}

/**
 * Public listener port used by a router's generated bootstrap profile.
 * The VPS forwards this per-router port to the shared management listener on
 * 1196. Using the router id makes the endpoint stable without storing another
 * mutable router field. The deployment reserves 11960-12959 for the first
 * 1000 router records.
 */
export function routerManagementVpnPortForRouter(routerId: number): number {
  if (!Number.isSafeInteger(routerId) || routerId <= 0) {
    throw new Error("A valid router id is required to allocate its management VPN port.");
  }
  const configuredBase = process.env.ROUTER_OPENVPN_PUBLIC_PORT_BASE?.trim();
  const base = configuredBase ? Number(configuredBase) : ROUTER_MANAGEMENT_VPN.publicPortBase;
  if (!Number.isInteger(base) || base < 1024 || base > 65534) {
    throw new Error("ROUTER_OPENVPN_PUBLIC_PORT_BASE must be an integer between 1024 and 65534");
  }
  const port = base + ((routerId - 1) % 1000);
  if (port > 65535) {
    throw new Error(`Router ${routerId} cannot be assigned a management VPN port.`);
  }
  return port;
}

function configuredEndpoint(): string {
  return (
    process.env.ROUTER_OPENVPN_ENDPOINT?.trim()
    || process.env.VPS_HOST?.trim()
    || ""
  );
}

function hasConfiguredEndpoint(): boolean {
  const endpoint = configuredEndpoint()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .replace(/:\d+$/, "")
    .trim();
  return /^[A-Za-z0-9:._-]+$/.test(endpoint);
}

export interface RouterManagementVpnReadiness {
  ready: boolean;
  endpointConfigured: boolean;
  serverReadyOverride: boolean;
  filesystemChecksRequired: boolean;
  checks: {
    caCertificate: boolean;
    easyRsa: boolean;
    dedicatedConfig: boolean;
    authFile: boolean;
    ccdDirectory: boolean;
  };
  missing: string[];
  port: number;
  network: string;
}

/**
 * Check the deployment prerequisites that the router installer depends on.
 *
 * In production the API normally runs beside the OpenVPN control plane, so
 * filesystem checks are meaningful. A separately hosted API may set the
 * explicit SERVER_READY flag after the VPS setup script has completed; this
 * avoids pretending that the API container can inspect another machine.
 */
export function routerManagementVpnReadiness(options: { remoteReady?: boolean } = {}): RouterManagementVpnReadiness {
  const serverReadyOverride = process.env.ROUTER_OPENVPN_SERVER_READY === "true" || options.remoteReady === true;
  const filesystemChecksRequired =
    process.env.NODE_ENV === "production"
    && !serverReadyOverride
    && process.env.ROUTER_OPENVPN_CHECK_FILESYSTEM !== "false";
  const endpointConfigured =
    process.env.NODE_ENV !== "production" || hasConfiguredEndpoint();
  const checks = {
    caCertificate: ROUTER_MANAGEMENT_VPN.caPaths.some(path => existsSync(path)),
    easyRsa: existsSync(ROUTER_MANAGEMENT_VPN.easyRsaPath),
    dedicatedConfig: existsSync(ROUTER_MANAGEMENT_VPN.configPath),
    authFile: existsSync(ROUTER_MANAGEMENT_VPN.authFilePath),
    ccdDirectory: existsSync(ROUTER_MANAGEMENT_VPN.ccdPath),
  };
  const missing: string[] = [];

  if (!endpointConfigured) missing.push("ROUTER_OPENVPN_ENDPOINT or VPS_HOST");
  if (filesystemChecksRequired) {
    if (!checks.caCertificate) missing.push("OpenVPN CA certificate");
    if (!checks.easyRsa) missing.push("Easy-RSA client certificate tooling");
    if (!checks.dedicatedConfig) missing.push(ROUTER_MANAGEMENT_VPN.configPath);
    if (!checks.authFile) missing.push(ROUTER_MANAGEMENT_VPN.authFilePath);
    if (!checks.ccdDirectory) missing.push(ROUTER_MANAGEMENT_VPN.ccdPath);
  }

  let port: number = ROUTER_MANAGEMENT_VPN.port;
  try {
    port = routerManagementVpnPort();
  } catch {
    missing.push("a valid ROUTER_OPENVPN_PORT");
  }

  return {
    ready: missing.length === 0,
    endpointConfigured,
    serverReadyOverride,
    filesystemChecksRequired,
    checks,
    missing,
    port,
    network: ROUTER_MANAGEMENT_VPN.network,
  };
}
