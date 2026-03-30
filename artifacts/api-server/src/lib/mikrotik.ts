import * as net from "net";
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

/* ─── TCP port probe ─────────────────────────────────────────────────────── */

export interface PortProbeResult {
  host: string;
  port: number;
  reachable: boolean;
  latencyMs: number;
  /** Raw socket error, if any */
  error?: string;
  /** Human-readable diagnosis — NAT, firewall, refused, DNS, etc. */
  diagnosis?: string;
}

/**
 * Probes whether a TCP port is open and reachable from this VPS.
 * This is a raw socket connect — it does NOT speak the RouterOS API protocol.
 * Use it to detect firewall blocks or NAT issues BEFORE attempting the API.
 *
 * Possible outcomes:
 *  - reachable=true  → port is open; RouterOS API login will be attempted next
 *  - ECONNREFUSED    → port reached but actively refused (API service may be disabled)
 *  - ETIMEDOUT       → no reply — likely a firewall DROP rule or NAT not forwarding
 *  - EHOSTUNREACH    → routing failure — wrong IP or VPS has no route to host
 *  - ENOTFOUND       → DNS resolution failed — use an IP address instead of hostname
 */
export async function probePort(
  host: string,
  port: number,
  timeoutMs = 5000
): Promise<PortProbeResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;

    const finish = (reachable: boolean, errorMsg?: string) => {
      if (done) return;
      done = true;
      sock.destroy();
      const latencyMs = Date.now() - start;

      let diagnosis: string | undefined;
      if (!reachable && errorMsg) {
        if (errorMsg.includes("ECONNREFUSED")) {
          diagnosis =
            `Port ${port} was reached but refused — the RouterOS API service ` +
            `may be disabled. Enable it under /ip service on the router.`;
        } else if (
          errorMsg.includes("ETIMEDOUT") ||
          errorMsg.toLowerCase().includes("timed out")
        ) {
          diagnosis =
            `Port ${port} did not respond within ${timeoutMs / 1000}s — ` +
            `likely blocked by a firewall DROP rule or NAT is not forwarding ` +
            `port ${port} to the router. Check /ip firewall filter and port-forward rules.`;
        } else if (
          errorMsg.includes("EHOSTUNREACH") ||
          errorMsg.includes("ENETUNREACH")
        ) {
          diagnosis =
            `Host ${host} is unreachable — routing failure. ` +
            `Verify the IP is correct and the VPS has a network path to it. ` +
            `If behind NAT with no public IP, configure a VPN tunnel instead.`;
        } else if (errorMsg.includes("ENOTFOUND")) {
          diagnosis =
            `Hostname "${host}" could not be resolved. ` +
            `Use the router's IP address directly instead of a hostname, ` +
            `or ensure DNS is correctly configured on the VPS.`;
        } else if (errorMsg.includes("EACCES")) {
          diagnosis =
            `Permission denied connecting to ${host}:${port}. ` +
            `Check OS-level firewall rules on the VPS (iptables/ufw).`;
        }
      }

      resolve({ host, port, reachable, latencyMs, error: errorMsg, diagnosis });
    };

    sock.setTimeout(timeoutMs);
    sock.on("connect", () => finish(true));
    sock.on("error",   (err) => finish(false, err.message));
    sock.on("timeout", () => finish(false, `Timed out after ${timeoutMs / 1000}s`));
    sock.connect(port, host);
  });
}

/* ─── Retry logic ────────────────────────────────────────────────────────── */

/**
 * Probes the TCP port first, then attempts the RouterOS API handshake.
 * Retries on transient failures with exponential backoff.
 *
 * Strategy per host:
 *   1. Probe TCP port — if blocked (timeout/refused), skip RouterOS API attempt
 *      and return a clear diagnosis without burning the full connect timeout
 *   2. If port is open, attempt RouterOS API login
 *   3. Try primary host (creds.host), then VPN fallback (creds.bridgeIp)
 *   4. Retry up to MAX_RETRIES times
 */
async function connectWithRetry(
  creds: RouterCredentials
): Promise<{ conn: RouterOSAPI; connectedHost: string; probe: PortProbeResult }> {
  const connectMs  = creds.connectTimeoutMs ?? DEFAULT_CONNECT_MS;
  /* Port probe uses a shorter timeout — fail fast, don't burn the full budget */
  const probeMs    = Math.min(connectMs, 6000);

  const hosts: Array<{ host: string; label: string; isVpn: boolean }> = [];

  const isVpnIp = (ip: string) => /^10\.8\./.test(ip);

  if (creds.host) {
    const vpn = isVpnIp(creds.host);
    const label = vpn
      ? `${creds.host} (VPN tunnel)`
      : isPrivateIp(creds.host)
        ? `${creds.host} (⚠ LAN IP — only reachable on local network)`
        : creds.host;
    hosts.push({ host: creds.host, label, isVpn: vpn });
  }
  if (creds.bridgeIp && creds.bridgeIp !== creds.host) {
    hosts.push({ host: creds.bridgeIp, label: `${creds.bridgeIp} (VPN tunnel)`, isVpn: true });
  }

  if (hosts.length === 0) {
    throw new Error("No host or bridge IP configured for this router");
  }

  let lastErr: Error = new Error("No connection attempts made");
  let lastProbe: PortProbeResult = { host: "", port: creds.port, reachable: false, latencyMs: 0 };

  for (let attempt = 1; attempt <= Math.max(1, MAX_RETRIES); attempt++) {
    for (const { host, label, isVpn } of hosts) {

      /* ── Step 1: TCP port probe ── */
      logger.debug({ host: label, port: creds.port, attempt }, "Port probe");
      const probe = await probePort(host, creds.port, probeMs);
      lastProbe = probe;

      if (!probe.reachable) {
        const diag = probe.diagnosis ?? probe.error ?? "unreachable";
        logger.warn(
          { host: label, port: creds.port, attempt, diagnosis: diag },
          "Port probe failed — skipping RouterOS API connect"
        );
        lastErr = new Error(
          `Port ${creds.port} on ${label} is not reachable ` +
          `(attempt ${attempt}/${MAX_RETRIES}): ${diag}`
        );
        /* Don't attempt RouterOS API when port is blocked — move to next host */
        continue;
      }

      logger.debug({ host: label, port: creds.port, latencyMs: probe.latencyMs }, "Port open");

      /* ── Step 2: RouterOS API login ── */
      const conn = makeConn(host, creds);
      try {
        logger.debug({ host: label, attempt }, "RouterOS API connect");
        await withTimeout(conn.connect(), connectMs);
        logger.debug({ host: label, attempt }, "RouterOS API connected");
        return { conn, connectedHost: host, probe };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ host: label, attempt, err: msg }, "RouterOS API connect failed");
        lastErr = new Error(
          `Port ${creds.port} is open on ${isVpn ? "VPN" : "public"} host ${label} ` +
          `but RouterOS API login failed (attempt ${attempt}/${MAX_RETRIES}): ${msg}. ` +
          `Check the API username and password, and that the API service is enabled.`
        );
        try { conn.close(); } catch { /* ignore */ }
      }
    }

    /* Exponential backoff between full retry rounds */
    if (attempt < MAX_RETRIES) {
      const delay = Math.min(500 * Math.pow(2, attempt - 1), 4000);
      logger.debug({ attempt, delayMs: delay }, "Retry backoff");
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw Object.assign(lastErr, { probe: lastProbe });
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

/**
 * Probes all candidate hosts (primary + VPN) in parallel without attempting
 * a full RouterOS API connection. Useful for pre-flight diagnostics.
 */
export async function probeAllHosts(
  creds: RouterCredentials,
  timeoutMs = 6000
): Promise<PortProbeResult[]> {
  const hosts: string[] = [];
  if (creds.host)     hosts.push(creds.host);
  if (creds.bridgeIp && creds.bridgeIp !== creds.host) hosts.push(creds.bridgeIp);
  if (hosts.length === 0) return [];
  return Promise.all(hosts.map(h => probePort(h, creds.port, timeoutMs)));
}

/* ═══ Router health ping ════════════════════════════════════════════════════
 * Quick connectivity + identity check. Returns status info on success,
 * throws on failure so the caller can mark the router as offline.
 * ═══════════════════════════════════════════════════════════════════════════ */
export interface RouterPingResult {
  online:      boolean;
  identity:    string;
  uptime:      string;
  version:     string;
  board:       string;
  cpuLoad:     number;
  freeMemory:  number;
  connectedAt: string;          /* ISO timestamp */
  connectedHost: string;        /* which IP was used */
}

export async function pingRouter(creds: RouterCredentials): Promise<RouterPingResult> {
  return withConn(creds, async (conn, connectedHost) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;

    const [identRows, resRows] = await Promise.all([
      withTimeout(conn.write(["/system/identity/print"]), ms) as Promise<Record<string, string>[]>,
      withTimeout(conn.write(["/system/resource/print"]), ms) as Promise<Record<string, string>[]>,
    ]);

    const id  = identRows[0] ?? {};
    const res = resRows[0]   ?? {};

    return {
      online:        true,
      identity:      id.name        ?? "unknown",
      uptime:        res.uptime     ?? "",
      version:       res.version    ?? "",
      board:         res["board-name"] ?? res["board"] ?? "",
      cpuLoad:       parseInt(res["cpu-load"] ?? "0", 10),
      freeMemory:    parseInt(res["free-memory"] ?? "0", 10),
      connectedAt:   new Date().toISOString(),
      connectedHost,
    };
  });
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

/* ══ Hotspot User Management ═══════════════════════════════════════════════ */
export interface HotspotUser {
  id: string;
  name: string;
  password: string;
  profile: string;
  comment: string;
  disabled: boolean;
  limitUptime: string;
  limitBytesTotal: number;
}

export async function fetchHotspotUserList(creds: RouterCredentials): Promise<HotspotUser[]> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ip/hotspot/user/print"]), ms)) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id:              r[".id"]             ?? "",
      name:            r.name              ?? "",
      password:        r.password          ?? "",
      profile:         r.profile           ?? "default",
      comment:         r.comment           ?? "",
      disabled:        parseBool(r.disabled),
      limitUptime:     r["limit-uptime"]   ?? "",
      limitBytesTotal: parseBytes(r["limit-bytes-total"]),
    }));
  });
}

export async function addHotspotUser(
  creds: RouterCredentials,
  opts: { name: string; password: string; profile?: string; comment?: string; server?: string }
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params = [
      "/ip/hotspot/user/add",
      `=name=${opts.name}`,
      `=password=${opts.password}`,
      `=profile=${opts.profile ?? "default"}`,
    ];
    if (opts.comment) params.push(`=comment=${opts.comment}`);
    if (opts.server)  params.push(`=server=${opts.server}`);
    await withTimeout(conn.write(params), ms);
  });
}

export async function removeHotspotUser(creds: RouterCredentials, name: string): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    /* Find the user by name first, then remove by .id */
    const rows = (await withTimeout(conn.write(["/ip/hotspot/user/print", `?name=${name}`]), ms)) as Record<string, string>[];
    const id = rows[0]?.[".id"];
    if (id) await withTimeout(conn.write(["/ip/hotspot/user/remove", `=.id=${id}`]), ms);
  });
}

export async function updateHotspotUser(
  creds: RouterCredentials,
  name: string,
  fields: { password?: string; profile?: string; disabled?: boolean; comment?: string }
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ip/hotspot/user/print", `?name=${name}`]), ms)) as Record<string, string>[];
    const id = rows[0]?.[".id"];
    if (!id) throw new Error(`Hotspot user '${name}' not found`);
    const params: string[] = ["/ip/hotspot/user/set", `=.id=${id}`];
    if (fields.password !== undefined) params.push(`=password=${fields.password}`);
    if (fields.profile  !== undefined) params.push(`=profile=${fields.profile}`);
    if (fields.disabled !== undefined) params.push(`=disabled=${fields.disabled ? "yes" : "no"}`);
    if (fields.comment  !== undefined) params.push(`=comment=${fields.comment}`);
    await withTimeout(conn.write(params), ms);
  });
}

/* ─── Wireless interfaces ────────────────────────────────────────────────── */

export interface WirelessInterface {
  id: string;
  name: string;
  ssid: string;
  disabled: boolean;
  band: string;
  channel: string;
  macAddress: string;
  securityProfile: string;
  mode: string;
}

export interface WirelessSecurityProfile {
  id: string;
  name: string;
  wpa2PreSharedKey: string;
  authentication: string;
}

export async function fetchWireless(
  creds: RouterCredentials
): Promise<{ interfaces: WirelessInterface[]; profiles: WirelessSecurityProfile[] }> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;

    const [ifaceRows, profileRows] = await Promise.all([
      withTimeout(conn.write(["/interface/wireless/print"]), ms) as Promise<Record<string, string>[]>,
      withTimeout(conn.write(["/interface/wireless/security-profiles/print"]), ms) as Promise<Record<string, string>[]>,
    ]);

    const interfaces: WirelessInterface[] = (Array.isArray(ifaceRows) ? ifaceRows : []).map(r => ({
      id:              r[".id"]              ?? "",
      name:            r.name               ?? "",
      ssid:            r.ssid               ?? "",
      disabled:        parseBool(r.disabled),
      band:            r.band               ?? "",
      channel:         r.channel            ?? "",
      macAddress:      r["mac-address"]     ?? "",
      securityProfile: r["security-profile"] ?? "default",
      mode:            r.mode               ?? "",
    }));

    const profiles: WirelessSecurityProfile[] = (Array.isArray(profileRows) ? profileRows : []).map(r => ({
      id:               r[".id"]                  ?? "",
      name:             r.name                    ?? "",
      wpa2PreSharedKey: r["wpa2-pre-shared-key"]  ?? "",
      authentication:   r["authentication-types"]  ?? "",
    }));

    return { interfaces, profiles };
  });
}

export async function setWirelessInterface(
  creds: RouterCredentials,
  interfaceId: string,
  params: { ssid?: string }
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const cmd: string[] = ["/interface/wireless/set", `=.id=${interfaceId}`];
    if (params.ssid !== undefined) cmd.push(`=ssid=${params.ssid}`);
    await withTimeout(conn.write(cmd), ms);
  });
}

export async function setWirelessSecurityProfile(
  creds: RouterCredentials,
  profileId: string,
  params: { password?: string }
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const cmd: string[] = ["/interface/wireless/security-profiles/set", `=.id=${profileId}`];
    if (params.password !== undefined) cmd.push(`=wpa2-pre-shared-key=${params.password}`);
    await withTimeout(conn.write(cmd), ms);
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

/* ══ PPP Secrets ═══════════════════════════════════════════════════════════ */
export interface PPPSecret {
  id: string;
  name: string;
  password: string;
  service: string;
  profile: string;
  localAddress: string;
  remoteAddress: string;
  disabled: boolean;
  comment: string;
}

export async function fetchPPPSecrets(creds: RouterCredentials): Promise<PPPSecret[]> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ppp/secret/print"]), ms)) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id:            r[".id"]              ?? "",
      name:          r.name               ?? "",
      password:      r.password           ?? "",
      service:       r.service            ?? "any",
      profile:       r.profile            ?? "default",
      localAddress:  r["local-address"]   ?? "",
      remoteAddress: r["remote-address"]  ?? "",
      disabled:      parseBool(r.disabled),
      comment:       r.comment            ?? "",
    }));
  });
}

export async function addPPPSecret(
  creds: RouterCredentials,
  opts: { name: string; password: string; profile?: string; service?: string; comment?: string }
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params = [
      "/ppp/secret/add",
      `=name=${opts.name}`,
      `=password=${opts.password}`,
      `=service=${opts.service ?? "pppoe"}`,
      `=profile=${opts.profile ?? "default"}`,
    ];
    if (opts.comment) params.push(`=comment=${opts.comment}`);
    await withTimeout(conn.write(params), ms);
  });
}

export async function removePPPSecret(creds: RouterCredentials, id: string): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    await withTimeout(conn.write(["/ppp/secret/remove", `=.id=${id}`]), ms);
  });
}

export async function updatePPPSecret(
  creds: RouterCredentials,
  id: string,
  fields: { password?: string; profile?: string; disabled?: boolean; comment?: string }
): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const params: string[] = ["/ppp/secret/set", `=.id=${id}`];
    if (fields.password  !== undefined) params.push(`=password=${fields.password}`);
    if (fields.profile   !== undefined) params.push(`=profile=${fields.profile}`);
    if (fields.disabled  !== undefined) params.push(`=disabled=${fields.disabled ? "yes" : "no"}`);
    if (fields.comment   !== undefined) params.push(`=comment=${fields.comment}`);
    await withTimeout(conn.write(params), ms);
  });
}

export async function disconnectPPPActive(creds: RouterCredentials, id: string): Promise<void> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    await withTimeout(conn.write(["/ppp/active/remove", `=.id=${id}`]), ms);
  });
}

/* ══ PPP Profiles ══════════════════════════════════════════════════════════ */
export interface PPPProfile {
  id: string;
  name: string;
  localAddress: string;
  remoteAddress: string;
  rateLimit: string;
  sessionTimeout: string;
  idleTimeout: string;
  comment: string;
}

export async function fetchPPPProfiles(creds: RouterCredentials): Promise<PPPProfile[]> {
  return withConn(creds, async (conn) => {
    const ms = creds.requestTimeoutMs ?? DEFAULT_REQUEST_MS;
    const rows = (await withTimeout(conn.write(["/ppp/profile/print"]), ms)) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id:             r[".id"]              ?? "",
      name:           r.name               ?? "",
      localAddress:   r["local-address"]   ?? "",
      remoteAddress:  r["remote-address"]  ?? "",
      rateLimit:      r["rate-limit"]      ?? "",
      sessionTimeout: r["session-timeout"] ?? "",
      idleTimeout:    r["idle-timeout"]    ?? "",
      comment:        r.comment            ?? "",
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

/* ─── Connection test ────────────────────────────────────────────────────── */

export interface ConnectionTestResult {
  ok: boolean;
  connectedHost: string;
  method: "public-ip" | "vpn-tunnel" | "failed";
  latencyMs: number;
  usingSSL: boolean;
  error?: string;
  warnings: string[];
  /**
   * Per-host TCP port probe results — run BEFORE the RouterOS API login.
   * Tells you immediately if a host is blocked by firewall/NAT.
   */
  portProbes: PortProbeResult[];
}

export async function testConnection(
  creds: RouterCredentials
): Promise<ConnectionTestResult> {
  const warnings: string[] = [];

  if (creds.host && isPrivateIp(creds.host)) {
    warnings.push(
      `Host ${creds.host} is a private/local IP. This will only work if the VPS ` +
      `is on the same LAN. For remote access, use the router's public IP or ` +
      `configure a VPN tunnel and set bridge_ip.`
    );
  }
  if (!creds.host && creds.bridgeIp) {
    warnings.push(
      `No public host configured — will attempt via VPN tunnel IP ${creds.bridgeIp} only.`
    );
  }

  /* Run port probes on ALL hosts in parallel FIRST — fast fail before API attempt */
  const probeMs    = Math.min(creds.connectTimeoutMs ?? DEFAULT_CONNECT_MS, 6000);
  const portProbes = await probeAllHosts(creds, probeMs);

  /* Log the probe summary */
  for (const p of portProbes) {
    if (p.reachable) {
      logger.info(
        { host: p.host, port: p.port, latencyMs: p.latencyMs },
        "Port probe: OPEN"
      );
    } else {
      logger.warn(
        { host: p.host, port: p.port, error: p.error, diagnosis: p.diagnosis },
        "Port probe: BLOCKED"
      );
      warnings.push(`${p.host}:${p.port} — ${p.diagnosis ?? p.error ?? "unreachable"}`);
    }
  }

  const anyPortOpen = portProbes.some(p => p.reachable);
  if (!anyPortOpen && portProbes.length > 0) {
    /* All hosts blocked — skip RouterOS API attempt entirely */
    const totalMs = portProbes.reduce((s, p) => s + p.latencyMs, 0);
    return {
      ok:            false,
      connectedHost: "",
      method:        "failed",
      latencyMs:     totalMs,
      usingSSL:      creds.useSSL ?? creds.port === 8729,
      error:
        `API port ${creds.port} is not reachable on any configured host. ` +
        `Check firewall rules, NAT port-forwarding, and that the API service ` +
        `is enabled on the router (/ip service enable api).`,
      warnings,
      portProbes,
    };
  }

  /* Port(s) open — now try the full RouterOS API handshake */
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
      usingSSL:   creds.useSSL ?? creds.port === 8729,
      warnings,
      portProbes,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok:            false,
      connectedHost: "",
      method:        "failed",
      latencyMs:     Date.now() - start,
      usingSSL:      creds.useSSL ?? creds.port === 8729,
      error:         msg,
      warnings,
      portProbes,
    };
  }
}

/* ─── OpenVPN setup script generator ────────────────────────────────────── */

export interface VpnSetupOptions {
  /** Public IP or hostname of the router (used for VPN endpoint) */
  routerPublicIp: string;
  /** VPS public IP — used to restrict who can connect via OVPN */
  vpsIp?: string;
  /** OpenVPN port on the router (default: 1194) */
  vpnPort?: number;
  /** VPN user to create on the router */
  vpnUsername?: string;
  /** VPN user password */
  vpnPassword?: string;
  /** IP pool CIDR for VPN tunnel addresses (default: 192.168.89.0/24) */
  tunnelNetwork?: string;
  /** Router's LAN network — VPN clients get access to this (default: 192.168.88.0/24) */
  lanNetwork?: string;
  /** Router ID for comments/labelling */
  routerId?: number;
}

/**
 * Generates a MikroTik RouterOS script (.rsc) that:
 *  1. Creates an IP pool for VPN clients
 *  2. Creates a PPP profile for the VPN user
 *  3. Creates the VPN user (PPP secret) with username/password
 *  4. Enables and configures the OpenVPN server
 *  5. Adds firewall rules to allow OpenVPN and API access from the VPN tunnel
 *  6. Optionally restricts OVPN connections to the VPS IP only
 *
 * Paste or import this on the router terminal:
 *   /import ovpn-setup.rsc
 */
export function generateVpnSetupScript(opts: VpnSetupOptions): string {
  const {
    routerPublicIp,
    vpsIp,
    vpnPort      = 1194,
    vpnUsername  = "admin",
    vpnPassword  = "ochola",
    tunnelNetwork = "192.168.89",
    lanNetwork   = "192.168.88.0/24",
    routerId,
  } = opts;

  const routerGateway = `${tunnelNetwork}.1`;   /* router end of tunnel */
  const clientStart   = `${tunnelNetwork}.2`;   /* first client IP */
  const clientEnd     = `${tunnelNetwork}.10`;  /* last client IP */
  const tunnelNet     = `${tunnelNetwork}.0/24`;
  const tag           = routerId ? `ISP-${routerId}` : "ISP-OVPN";
  const vpsRestrict   = vpsIp
    ? `src-address=${vpsIp} `
    : "";
  const vpsNote       = vpsIp
    ? `# VPN access restricted to VPS IP: ${vpsIp}`
    : `# WARNING: OVPN port open to all IPs — set vpsIp to restrict access`;

  return `# ═══════════════════════════════════════════════════════════════
# OcholaSupernet — MikroTik OpenVPN Server Setup
# Generated : ${new Date().toISOString()}
# Router IP : ${routerPublicIp}
# VPN Port  : ${vpnPort}/tcp
# VPN User  : ${vpnUsername}  (password stored in PPP secrets)
# Tunnel    : ${tunnelNet}
# LAN Access: ${lanNetwork}
# ${vpsNote}
#
# USAGE: Paste into RouterOS terminal, or upload and run:
#          /import ovpn-setup-router${routerId ?? ""}.rsc
# ═══════════════════════════════════════════════════════════════

# ── Step 1: IP pool for VPN clients ─────────────────────────────────────────
/ip pool
add name=ovpn-pool ranges=${clientStart}-${clientEnd} comment="${tag}"

# ── Step 2: PPP profile for VPN sessions ────────────────────────────────────
/ppp profile
add name=ovpn-profile \\
    local-address=${routerGateway} \\
    remote-address=ovpn-pool \\
    use-compression=no \\
    use-encryption=yes \\
    use-upnp=no \\
    dns-server=8.8.8.8,1.1.1.1 \\
    comment="${tag}"

# ── Step 3: VPN user account (PPP secret) ───────────────────────────────────
# Password is stored in the router's PPP secrets — not in any config file.
/ppp secret
add name=${vpnUsername} \\
    password=${vpnPassword} \\
    profile=ovpn-profile \\
    service=ovpn \\
    local-address=${routerGateway} \\
    remote-address=${clientStart} \\
    comment="${tag} — default VPN/API admin (OcholaSupernet backend)"

# ── Step 4: OpenVPN server ───────────────────────────────────────────────────
# Requires a certificate. If you don't have one, generate a self-signed cert:
#   /certificate add name=ovpn-ca common-name=ovpn-ca key-usage=key-cert-sign,crl-sign
#   /certificate sign ovpn-ca
#   /certificate add name=ovpn-server common-name=${routerPublicIp}
#   /certificate sign ovpn-server ca=ovpn-ca
/interface ovpn-server server
set enabled=yes \\
    port=${vpnPort} \\
    mode=ip \\
    protocol=tcp \\
    auth=sha1 \\
    cipher=aes128,aes192,aes256 \\
    default-profile=ovpn-profile \\
    require-client-certificate=no \\
    certificate=none

# ── Step 5: Firewall rules ───────────────────────────────────────────────────
/ip firewall filter

# 5a. Allow OpenVPN connections (port ${vpnPort}) on WAN
add action=accept chain=input \\
    ${vpsRestrict}protocol=tcp dst-port=${vpnPort} \\
    in-interface-list=WAN \\
    comment="${tag}-allow-ovpn"

# 5b. Allow API access (8728 plain + 8729 SSL) from VPN tunnel
add action=accept chain=input \\
    src-address=${tunnelNet} \\
    protocol=tcp dst-port=8728,8729 \\
    comment="${tag}-api-from-vpn"

# 5c. Allow full LAN access from VPN tunnel (PPPoE/Hotspot management)
add action=accept chain=forward \\
    src-address=${tunnelNet} \\
    dst-address=${lanNetwork} \\
    comment="${tag}-lan-from-vpn"

# ── Step 6: Enable the API service (if not already) ─────────────────────────
/ip service
enable api
# enable api-ssl   # uncomment if you want encrypted API-SSL on port 8729

# ── Step 7: Route — allow VPN clients to reach the LAN ──────────────────────
# (Usually handled automatically; add only if your routing table needs it)
# /ip route add dst-address=${lanNetwork} gateway=${routerGateway}

# ── Verify ───────────────────────────────────────────────────────────────────
:log info "${tag}: OpenVPN server configured. User '${vpnUsername}' created."
:log info "${tag}: VPN clients will get IPs in ${tunnelNet}"
:log info "${tag}: API accessible at ${routerGateway}:8728 from VPN tunnel"
`;
}

/* ─── OpenVPN client config (.ovpn) generator ────────────────────────────── */

export interface OvpnClientOptions {
  /** Router's public IP or hostname — the VPN endpoint */
  routerPublicIp: string;
  /** OpenVPN port on the router (default: 1194) */
  vpnPort?: number;
  /** VPN username for auth-user-pass */
  vpnUsername?: string;
  /** VPN password — CAUTION: only embed in .ovpn for dev/testing;
   *  production setups should use a separate credentials file */
  vpnPassword?: string;
  /** Expected VPN tunnel IP the router will assign to this client */
  tunnelClientIp?: string;
  /** Router's LAN network to route through VPN (default: 192.168.88.0/24) */
  lanNetwork?: string;
  /** API port(s) to reach through the tunnel (informational, in comment) */
  apiPorts?: string;
  /** Whether to route ALL traffic through VPN (default: false = split tunnel) */
  routeAll?: boolean;
}

/**
 * Generates a .ovpn client configuration file for the VPS to connect
 * to the router's OpenVPN server.
 *
 * Save as /etc/openvpn/router-admin.ovpn on the VPS and run:
 *   openvpn --config /etc/openvpn/router-admin.ovpn --daemon
 */
export function generateOvpnClientConfig(opts: OvpnClientOptions): string {
  const {
    routerPublicIp,
    vpnPort        = 1194,
    vpnUsername    = "admin",
    vpnPassword    = "ochola",
    tunnelClientIp = "192.168.89.2",
    lanNetwork     = "192.168.88.0/24",
    apiPorts       = "8728, 8729",
    routeAll       = false,
  } = opts;

  /* LAN route: e.g. "192.168.88.0 255.255.255.0" */
  const [lanBase, lanPrefix] = lanNetwork.split("/");
  const lanMask = prefixToMask(parseInt(lanPrefix ?? "24", 10));

  return `# ═══════════════════════════════════════════════════════════════
# OcholaSupernet — VPS OpenVPN Client Configuration
# Generated  : ${new Date().toISOString()}
# Server     : ${routerPublicIp}:${vpnPort}/tcp
# VPN user   : ${vpnUsername}
# Tunnel IP  : ${tunnelClientIp}  (assigned by router)
# LAN access : ${lanNetwork}  (PPPoE/Hotspot management)
# API ports  : ${apiPorts}  (reachable at router tunnel IP after connect)
#
# USAGE on VPS:
#   1. Install OpenVPN:  apt install openvpn
#   2. Save this file:   /etc/openvpn/router-admin.ovpn
#   3. Create creds:     echo "${vpnUsername}\\n${vpnPassword}" > /etc/openvpn/router-creds.txt
#                        chmod 600 /etc/openvpn/router-creds.txt
#   4. Connect:          openvpn --config /etc/openvpn/router-admin.ovpn --daemon
#   5. Verify:           ip addr show tun0    # should show ${tunnelClientIp}
#                        ping 192.168.89.1    # ping router tunnel endpoint
#                        curl http://192.168.89.1:8728  # test API port
#
# ENVIRONMENT VARIABLE — set in OcholaSupernet backend:
#   MIKROTIK_BRIDGE_IP=${tunnelClientIp.replace(/\.\d+$/, ".1")}  # router's tunnel IP
#
# ── SECURITY NOTE ─────────────────────────────────────────────
# The credentials below are for DEVELOPMENT / initial setup only.
# In production, keep credentials in a separate file (see step 3 above)
# and remove the <auth-user-pass> inline block.
# ═══════════════════════════════════════════════════════════════

client
dev tun
proto tcp

# OpenVPN server endpoint
remote ${routerPublicIp} ${vpnPort}

resolv-retry infinite
nobind
persist-key
persist-tun

# Authentication
auth SHA1
cipher AES-128-CBC
auth-nocache

# Credentials — store in a separate file for production:
#   auth-user-pass /etc/openvpn/router-creds.txt
<auth-user-pass>
${vpnUsername}
${vpnPassword}
</auth-user-pass>

# MikroTik uses self-signed certs by default
tls-client
# If you configured a CA on the router, add:
# <ca>
# -----BEGIN CERTIFICATE-----
# ... paste router CA cert here ...
# -----END CERTIFICATE-----
# </ca>

# Disable cert verification for self-signed (remove in production with proper cert)
verify-x509-name none
# OR: ns-cert-type server   (for older RouterOS)

${routeAll
  ? `# Route ALL traffic through VPN
redirect-gateway def1`
  : `# Split tunnel — only route LAN traffic through VPN (recommended)
route-nopull
route ${lanBase} ${lanMask}
# Route to router tunnel subnet (auto-assigned by server, but explicit here for clarity)
route 192.168.89.0 255.255.255.0`}

# Logging
verb 3
log /var/log/openvpn-router.log
`;
}

/** Convert CIDR prefix length to dotted-decimal subnet mask */
function prefixToMask(prefix: number): string {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return [24, 16, 8, 0].map(s => (mask >> s) & 255).join(".");
}

/* ─── Router as OpenVPN CLIENT script generator ──────────────────────────── */

export interface RouterAsClientOptions {
  /** VPS public IP that is running the OpenVPN server */
  vpsPublicIp: string;
  /** OpenVPN server port on the VPS (default 1194) */
  vpnPort?: number;
  /** Username to authenticate with the VPS OVPN server */
  vpnUsername?: string;
  /** Password for the VPN user */
  vpnPassword?: string;
  /**
   * VPN tunnel IP the VPS server will assign to the router.
   * Depends on the VPS server's IP pool (default "10.8.0.2").
   */
  tunnelRouterIp?: string;
  /** VPS tunnel IP (gateway end, default "10.8.0.1") */
  tunnelVpsIp?: string;
  /** Router LAN network for routing rules (default "192.168.88.0/24") */
  lanNetwork?: string;
  /** Router ID for comment labels */
  routerId?: number;
}

/**
 * Generates a MikroTik RouterOS script (.rsc) that configures the router
 * as an OpenVPN CLIENT connecting back to the VPS server.
 *
 * Architecture (correct for this setup):
 *   VPS  ──── OpenVPN SERVER (tun0 10.8.0.1) ◄──── MikroTik OVPN CLIENT (gets 10.8.0.2)
 *
 * After connect, the backend reaches the router API at:
 *   MIKROTIK_BRIDGE_IP=10.8.0.2  (router's tunnel IP)
 *
 * Import on the router:
 *   /import router-as-client.rsc
 */
export function generateRouterAsClientScript(opts: RouterAsClientOptions): string {
  const {
    vpsPublicIp,
    vpnPort         = 1194,
    vpnUsername     = "admin",
    vpnPassword     = "ochola",
    tunnelRouterIp  = "10.8.0.2",
    tunnelVpsIp     = "10.8.0.1",
    lanNetwork      = "192.168.88.0/24",
    routerId,
  } = opts;

  const tag = routerId ? `ISP-${routerId}` : "ISP-OVPN";

  return `# ═══════════════════════════════════════════════════════════════
# OcholaSupernet — MikroTik Router as OpenVPN CLIENT
# Generated  : ${new Date().toISOString()}
# Architecture: Router connects TO VPS (VPS is the OVPN server)
#
# VPS OVPN server : ${vpsPublicIp}:${vpnPort}/tcp  (tun0 ${tunnelVpsIp})
# Router tunnel IP: ${tunnelRouterIp}  (assigned by VPS server after connect)
# VPN user        : ${vpnUsername}
#
# After import:
#   - Router connects to VPS and gets tunnel IP ${tunnelRouterIp}
#   - Backend: set MIKROTIK_BRIDGE_IP=${tunnelRouterIp}
#   - API reaches router at ${tunnelRouterIp}:8728
#
# REQUIREMENTS on VPS side (run vps-ovpn-setup.sh first):
#   - VPS OpenVPN server must use proto tcp
#   - User '${vpnUsername}' must be added to /etc/openvpn/easy-rsa or auth file
#   - tls-auth should be disabled or compatible with MikroTik
#
# USAGE: /import router-as-client${routerId ?? ""}.rsc
# ═══════════════════════════════════════════════════════════════

# ── Step 1: Create the OVPN client interface ─────────────────────────────────
/interface ovpn-client
add name=ovpn-to-vps \\
    connect-to=${vpsPublicIp} \\
    port=${vpnPort} \\
    mode=ip \\
    user=${vpnUsername} \\
    password=${vpnPassword} \\
    auth=sha1 \\
    cipher=aes128 \\
    add-default-route=no \\
    disabled=no \\
    comment="${tag} — VPS tunnel"

# ── Step 2: Allow API access from VPN tunnel ─────────────────────────────────
# The VPS reaches the router's API at ${tunnelRouterIp}:8728 through the tunnel.
/ip firewall filter
add action=accept chain=input \\
    src-address=${tunnelVpsIp}/32 \\
    protocol=tcp dst-port=8728,8729 \\
    comment="${tag}-api-from-vps-tunnel"

# ── Step 3: Allow ping from VPS (connectivity check) ─────────────────────────
add action=accept chain=input \\
    src-address=${tunnelVpsIp}/32 \\
    protocol=icmp \\
    comment="${tag}-ping-from-vps-tunnel"

# ── Step 4: Ensure API service is enabled ────────────────────────────────────
/ip service
enable api
# enable api-ssl   # uncomment for port 8729 encrypted API

# ── Step 5: Verify the interface came up ─────────────────────────────────────
# Run this in terminal after import — should show "R" (running):
#   /interface print where name=ovpn-to-vps
#   /ip address print where interface=ovpn-to-vps
#
# Expected: inet ${tunnelRouterIp} on ovpn-to-vps
# Then from VPS:  ping ${tunnelRouterIp}  and  curl http://${tunnelRouterIp}:8728

:log info "${tag}: OVPN client configured → ${vpsPublicIp}:${vpnPort}"
:log info "${tag}: After connect, router API reachable at ${tunnelRouterIp}:8728"
`;
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
