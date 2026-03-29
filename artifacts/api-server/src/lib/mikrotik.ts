import { RouterOSAPI } from "node-routeros";
import { logger } from "./logger";

/* ─── Credential types ───────────────────────────────────────────────────── */

export interface RouterCredentials {
  /** Primary host — should be a public IP or hostname, not 192.168.x.x */
  host: string;
  /** MikroTik API port. 8728 = plain, 8729 = API-SSL (preferred for remote). */
  port: number;
  username: string;
  password: string;
  /** Use API-SSL (TLS). Auto-enabled when port === 8729. */
  useSSL?: boolean;
  /**
   * VPN tunnel IP — used as a fallback when the primary host is unreachable.
   * Typically the IP the MikroTik receives inside an OpenVPN tunnel.
   */
  bridgeIp?: string;
  /** Override connect timeout in ms (default: MIKROTIK_CONNECT_TIMEOUT or 15000) */
  connectTimeoutMs?: number;
  /** Override per-request timeout in ms (default: MIKROTIK_REQUEST_TIMEOUT or 20000) */
  requestTimeoutMs?: number;
}

/* ─── Private IP detection ───────────────────────────────────────────────── */

const PRIVATE_RANGES = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^127\./,
  /^::1$/,
  /^localhost$/i,
];

export function isPrivateIp(host: string): boolean {
  return PRIVATE_RANGES.some(r => r.test(host.trim()));
}

/* ─── Global timeouts from env vars ─────────────────────────────────────── */

const DEFAULT_CONNECT_MS = parseInt(
  process.env["MIKROTIK_CONNECT_TIMEOUT"] ?? "15000", 10
);
const DEFAULT_REQUEST_MS = parseInt(
  process.env["MIKROTIK_REQUEST_TIMEOUT"] ?? "20000", 10
);
const MAX_RETRIES = parseInt(
  process.env["MIKROTIK_MAX_RETRIES"] ?? "2", 10
);

/* ─── Environment-variable credentials ──────────────────────────────────── */

/**
 * Reads the "default" router credentials from environment variables.
 * Returns null if MIKROTIK_HOST is not set.
 *
 * Required:
 *   MIKROTIK_HOST      — router PUBLIC IP or hostname (avoid 192.168.x.x)
 *   MIKROTIK_PASSWORD  — API password (store as a Secret, never hardcode)
 *
 * Optional:
 *   MIKROTIK_USERNAME           — API username (default: "admin")
 *   MIKROTIK_PORT               — API port    (default: 8728 plain / 8729 SSL)
 *   MIKROTIK_USE_SSL            — "true" to force API-SSL
 *   MIKROTIK_TLS_VERIFY         — "true" to enforce TLS cert validation
 *   MIKROTIK_BRIDGE_IP          — VPN tunnel IP fallback
 *   MIKROTIK_CONNECT_TIMEOUT    — connect timeout in ms (default 15000)
 *   MIKROTIK_REQUEST_TIMEOUT    — request timeout in ms (default 20000)
 *   MIKROTIK_MAX_RETRIES        — connection attempts (default 2)
 */
export function getEnvCredentials(): RouterCredentials | null {
  const host = process.env["MIKROTIK_HOST"]?.trim();
  if (!host) return null;

  const password  = process.env["MIKROTIK_PASSWORD"] ?? "";
  const username  = process.env["MIKROTIK_USERNAME"] ?? "admin";
  const bridgeIp  = process.env["MIKROTIK_BRIDGE_IP"]?.trim() || undefined;
  const useSSL    = process.env["MIKROTIK_USE_SSL"]?.toLowerCase() === "true";
  const rawPort   = process.env["MIKROTIK_PORT"];
  const port      = rawPort ? parseInt(rawPort, 10) : useSSL ? 8729 : 8728;

  if (!password) {
    logger.warn("MIKROTIK_PASSWORD is not set — connection will likely fail");
  }
  if (isPrivateIp(host)) {
    logger.warn(
      { host },
      "MIKROTIK_HOST appears to be a private/local IP. " +
      "The VPS cannot reach this address over the internet. " +
      "Use the router's public IP or set MIKROTIK_BRIDGE_IP for VPN tunnel access."
    );
  }

  return {
    host,
    port,
    username,
    password,
    useSSL: useSSL || port === 8729,
    bridgeIp,
  };
}

/* ─── Connection factory ─────────────────────────────────────────────────── */

function makeConn(host: string, creds: RouterCredentials): RouterOSAPI {
  const ssl = creds.useSSL ?? creds.port === 8729;
  const connectSec = Math.ceil((creds.connectTimeoutMs ?? DEFAULT_CONNECT_MS) / 1000);
  return new RouterOSAPI({
    host,
    port:      creds.port,
    user:      creds.username,
    password:  creds.password,
    timeout:   connectSec,
    keepalive: false,
    ...(ssl
      ? {
          tls: {
            /* RouterOS uses self-signed certs by default.
               Set MIKROTIK_TLS_VERIFY=true only if the router has
               a properly signed certificate installed.               */
            rejectUnauthorized: process.env["MIKROTIK_TLS_VERIFY"] === "true",
          },
        }
      : {}),
  });
}

/* ─── Timeout helper ─────────────────────────────────────────────────────── */

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Operation timed out after ${ms / 1000}s`)),
        ms
      )
    ),
  ]);
}

/* ─── Retry logic ────────────────────────────────────────────────────────── */

/**
 * Attempts to connect to the router, retrying on transient failures.
 * Returns the connected RouterOSAPI instance.
 *
 * Strategy:
 *   1. Try primary host (creds.host)
 *   2. If that fails and bridgeIp is set, try VPN tunnel IP
 *   3. Retry up to MAX_RETRIES times with exponential backoff
 */
async function connectWithRetry(
  creds: RouterCredentials
): Promise<{ conn: RouterOSAPI; connectedHost: string }> {
  const connectMs = creds.connectTimeoutMs ?? DEFAULT_CONNECT_MS;
  const hosts: Array<{ host: string; label: string }> = [];

  if (creds.host) {
    const label = isPrivateIp(creds.host)
      ? `${creds.host} (⚠ private IP — VPS may not reach this)`
      : creds.host;
    hosts.push({ host: creds.host, label });
  }
  if (creds.bridgeIp && creds.bridgeIp !== creds.host) {
    hosts.push({ host: creds.bridgeIp, label: `${creds.bridgeIp} (VPN tunnel)` });
  }

  if (hosts.length === 0) {
    throw new Error("No host or bridge IP configured for this router");
  }

  let lastErr: Error = new Error("No connection attempts made");

  for (let attempt = 1; attempt <= Math.max(1, MAX_RETRIES); attempt++) {
    for (const { host, label } of hosts) {
      const conn = makeConn(host, creds);
      try {
        logger.debug({ host: label, attempt }, "MikroTik connect attempt");
        await withTimeout(conn.connect(), connectMs);
        logger.debug({ host: label, attempt }, "MikroTik connected");
        return { conn, connectedHost: host };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ host: label, attempt, err: msg }, "MikroTik connect failed");
        lastErr = new Error(
          `Cannot reach router at ${label} (attempt ${attempt}/${MAX_RETRIES}): ${msg}`
        );
        try { conn.close(); } catch { /* ignore */ }
      }
    }

    /* Exponential backoff between full retry rounds (not between hosts) */
    if (attempt < MAX_RETRIES) {
      const delay = Math.min(500 * Math.pow(2, attempt - 1), 4000);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastErr;
}

/* ─── Helper: run a command with a connected client ─────────────────────── */

async function withConn<T>(
  creds: RouterCredentials,
  fn: (conn: RouterOSAPI, connectedHost: string) => Promise<T>
): Promise<T> {
  const { conn, connectedHost } = await connectWithRetry(creds);
  try {
    return await fn(conn, connectedHost);
  } finally {
    try { conn.close(); } catch { /* ignore */ }
  }
}

/* ─── Data types ─────────────────────────────────────────────────────────── */

export interface ActiveHotspotUser {
  id: string;
  user: string;
  address: string;
  macAddress: string;
  uptime: string;
  bytesIn: number;
  bytesOut: number;
  server: string;
}

export interface ActivePPPoESession {
  id: string;
  name: string;
  address: string;
  uptime: string;
  bytesIn: number;
  bytesOut: number;
  service: string;
}

export interface RouterInterface {
  id: string;
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  macAddress: string;
  comment: string;
  txBps: number;
  rxBps: number;
}

export interface TrafficStats {
  iface: string;
  rxBitsPerSecond: number;
  txBitsPerSecond: number;
}

export interface RouterLiveData {
  hotspotUsers: ActiveHotspotUser[];
  pppoeUsers: ActivePPPoESession[];
  interfaces: RouterInterface[];
  traffic: TrafficStats[];
  fetchedAt: string;
  usingSSL: boolean;
  connectedHost: string;
}

/* ─── Parsers ────────────────────────────────────────────────────────────── */

function parseBytes(val: unknown): number {
  const n = parseInt(String(val ?? "0"), 10);
  return isNaN(n) ? 0 : n;
}

function parseBool(val: unknown): boolean {
  return String(val ?? "false").toLowerCase() !== "false";
}

/* ─── Fetch functions ────────────────────────────────────────────────────── */

export async function fetchHotspotUsers(
  creds: RouterCredentials
): Promise<ActiveHotspotUser[]> {
  return withConn(creds, async (conn) => {
    const requestMs = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(
      conn.write(["/ip/hotspot/active/print"]),
      requestMs
    )) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id:         r[".id"]         ?? "",
      user:       r.user           ?? "",
      address:    r.address        ?? "",
      macAddress: r["mac-address"] ?? "",
      uptime:     r.uptime         ?? "",
      bytesIn:    parseBytes(r["bytes-in"]),
      bytesOut:   parseBytes(r["bytes-out"]),
      server:     r.server         ?? "",
    }));
  });
}

export async function fetchPPPoEActive(
  creds: RouterCredentials
): Promise<ActivePPPoESession[]> {
  return withConn(creds, async (conn) => {
    const requestMs = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(
      conn.write(["/ppp/active/print"]),
      requestMs
    )) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id:       r[".id"]        ?? "",
      name:     r.name          ?? "",
      address:  r.address       ?? "",
      uptime:   r.uptime        ?? "",
      bytesIn:  parseBytes(r["bytes-in"]),
      bytesOut: parseBytes(r["bytes-out"]),
      service:  r.service       ?? "",
    }));
  });
}

export async function fetchInterfaces(
  creds: RouterCredentials
): Promise<RouterInterface[]> {
  return withConn(creds, async (conn) => {
    const requestMs = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(
      conn.write(["/interface/print"]),
      requestMs
    )) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id:         r[".id"]         ?? "",
      name:       r.name           ?? "",
      type:       r.type           ?? "",
      running:    parseBool(r.running),
      disabled:   parseBool(r.disabled),
      macAddress: r["mac-address"] ?? "",
      comment:    r.comment        ?? "",
      txBps:      parseBytes(r["tx-byte"]),
      rxBps:      parseBytes(r["rx-byte"]),
    }));
  });
}

export async function fetchTraffic(
  creds: RouterCredentials,
  interfaces: string[] = []
): Promise<TrafficStats[]> {
  return withConn(creds, async (conn) => {
    const requestMs = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;

    let ifaceNames = interfaces;
    if (ifaceNames.length === 0) {
      const rows = (await withTimeout(
        conn.write(["/interface/print"]),
        requestMs
      )) as Record<string, string>[];
      ifaceNames = (Array.isArray(rows) ? rows : [])
        .filter((r) => parseBool(r.running) && !parseBool(r.disabled))
        .map((r) => r.name)
        .filter(Boolean)
        .slice(0, 8);
    }

    if (ifaceNames.length === 0) return [];

    const samples = (await withTimeout(
      conn.write([
        "/interface/monitor-traffic",
        `=interface=${ifaceNames.join(",")}`,
        "=once=",
      ]),
      requestMs
    )) as Record<string, string>[];

    return (Array.isArray(samples) ? samples : []).map((s, i) => ({
      iface:           s.name             ?? ifaceNames[i] ?? `iface${i}`,
      rxBitsPerSecond: parseBytes(s["rx-bits-per-second"]),
      txBitsPerSecond: parseBytes(s["tx-bits-per-second"]),
    }));
  });
}

/* ─── Combined fetch ─────────────────────────────────────────────────────── */

export async function fetchRouterLiveData(
  creds: RouterCredentials
): Promise<RouterLiveData> {
  const usingSSL = creds.useSSL ?? creds.port === 8729;

  /* Share a single connection across all queries for efficiency */
  const { conn, connectedHost } = await connectWithRetry(creds);
  const requestMs = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;

  try {
    /* Hotspot users */
    const hotspotRows = await withTimeout(
      conn.write(["/ip/hotspot/active/print"]),
      requestMs
    ).catch(e => { logger.warn({ err: e.message }, "hotspot fetch failed"); return [] as Record<string, string>[]; });

    /* PPPoE sessions */
    const pppoeRows = await withTimeout(
      conn.write(["/ppp/active/print"]),
      requestMs
    ).catch(e => { logger.warn({ err: e.message }, "pppoe fetch failed"); return [] as Record<string, string>[]; });

    /* Interfaces */
    const ifaceRows = await withTimeout(
      conn.write(["/interface/print"]),
      requestMs
    ).catch(e => { logger.warn({ err: e.message }, "interface fetch failed"); return [] as Record<string, string>[]; });

    const interfaces: RouterInterface[] = (Array.isArray(ifaceRows) ? ifaceRows : []).map(r => ({
      id:         r[".id"]         ?? "",
      name:       r.name           ?? "",
      type:       r.type           ?? "",
      running:    parseBool(r.running),
      disabled:   parseBool(r.disabled),
      macAddress: r["mac-address"] ?? "",
      comment:    r.comment        ?? "",
      txBps:      parseBytes(r["tx-byte"]),
      rxBps:      parseBytes(r["rx-byte"]),
    }));

    /* Traffic — reuse the connection, only sample running interfaces */
    const runningIfaces = interfaces
      .filter(i => i.running && !i.disabled)
      .map(i => i.name)
      .slice(0, 8);

    let traffic: TrafficStats[] = [];
    if (runningIfaces.length > 0) {
      const samples = await withTimeout(
        conn.write([
          "/interface/monitor-traffic",
          `=interface=${runningIfaces.join(",")}`,
          "=once=",
        ]),
        requestMs
      ).catch(e => { logger.warn({ err: e.message }, "traffic fetch failed"); return [] as Record<string, string>[]; });

      traffic = (Array.isArray(samples) ? samples : []).map((s, i) => ({
        iface:           s.name             ?? runningIfaces[i] ?? `iface${i}`,
        rxBitsPerSecond: parseBytes(s["rx-bits-per-second"]),
        txBitsPerSecond: parseBytes(s["tx-bits-per-second"]),
      }));
    }

    return {
      hotspotUsers: (Array.isArray(hotspotRows) ? hotspotRows : []).map(r => ({
        id:         r[".id"]         ?? "",
        user:       r.user           ?? "",
        address:    r.address        ?? "",
        macAddress: r["mac-address"] ?? "",
        uptime:     r.uptime         ?? "",
        bytesIn:    parseBytes(r["bytes-in"]),
        bytesOut:   parseBytes(r["bytes-out"]),
        server:     r.server         ?? "",
      })),
      pppoeUsers: (Array.isArray(pppoeRows) ? pppoeRows : []).map(r => ({
        id:       r[".id"]        ?? "",
        name:     r.name          ?? "",
        address:  r.address       ?? "",
        uptime:   r.uptime        ?? "",
        bytesIn:  parseBytes(r["bytes-in"]),
        bytesOut: parseBytes(r["bytes-out"]),
        service:  r.service       ?? "",
      })),
      interfaces,
      traffic,
      fetchedAt: new Date().toISOString(),
      usingSSL,
      connectedHost,
    };
  } finally {
    try { conn.close(); } catch { /* ignore */ }
  }
}

/* ─── Connection test (quick ping without fetching full data) ────────────── */

export interface ConnectionTestResult {
  ok: boolean;
  connectedHost: string;
  method: "public-ip" | "vpn-tunnel" | "failed";
  latencyMs: number;
  usingSSL: boolean;
  error?: string;
  warnings: string[];
}

export async function testConnection(
  creds: RouterCredentials
): Promise<ConnectionTestResult> {
  const warnings: string[] = [];
  if (isPrivateIp(creds.host)) {
    warnings.push(
      `Host ${creds.host} is a private/local IP. This will only work if the VPS ` +
      `is on the same LAN. For remote access, use the router's public IP or ` +
      `configure MIKROTIK_BRIDGE_IP for VPN tunnel access.`
    );
  }

  const start = Date.now();
  try {
    const { conn, connectedHost } = await connectWithRetry(creds);
    const latencyMs = Date.now() - start;
    try { conn.close(); } catch { /* ignore */ }
    const method: ConnectionTestResult["method"] =
      connectedHost === creds.bridgeIp ? "vpn-tunnel" : "public-ip";
    return {
      ok: true,
      connectedHost,
      method,
      latencyMs,
      usingSSL: creds.useSSL ?? creds.port === 8729,
      warnings,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      connectedHost: "",
      method: "failed",
      latencyMs: Date.now() - start,
      usingSSL: creds.useSSL ?? creds.port === 8729,
      error: msg,
      warnings,
    };
  }
}

/* ─── MikroTik firewall script generator ────────────────────────────────── */

/**
 * Generates a MikroTik RouterOS script that restricts API access to a
 * specific VPS IP, blocking all other connections to port 8728 and 8729.
 *
 * The user should paste this into the router's terminal:
 *   /import mikrotik-firewall.rsc
 */
export function generateFirewallScript(vpsIp: string, options?: {
  enableApiSsl?: boolean;
  comment?: string;
}): string {
  const { enableApiSsl = true, comment = "VPS-ONLY" } = options ?? {};
  const ports = enableApiSsl ? "8728,8729" : "8728";

  return `# OcholaSupernet — MikroTik API Firewall Rules
# Generated: ${new Date().toISOString()}
# Purpose: Allow API access ONLY from VPS IP ${vpsIp}
# Paste into terminal or upload and run: /import filename.rsc

# ── 1. Allow API from VPS (must come FIRST) ──────────────────────────────
/ip firewall filter
add action=accept chain=input comment="${comment}-allow-api" \\
    dst-port=${ports} in-interface-list=WAN protocol=tcp \\
    src-address=${vpsIp}

# ── 2. Drop API access from all other sources ─────────────────────────────
add action=drop chain=input comment="${comment}-block-api" \\
    dst-port=${ports} in-interface-list=WAN protocol=tcp

# ── 3. (Optional) Enable API-SSL service on port 8729 ────────────────────
${enableApiSsl ? "/ip service enable api-ssl" : "# /ip service enable api-ssl  (uncomment to enable)"}

# ── Verify — check that the rules are in place ───────────────────────────
# :log info "Firewall rules applied. API restricted to ${vpsIp} only."
`;
}
