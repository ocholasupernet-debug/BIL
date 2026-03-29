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

  if (creds.host) {
    const label = isPrivateIp(creds.host)
      ? `${creds.host} (⚠ private IP — VPS may not reach this)`
      : creds.host;
    hosts.push({ host: creds.host, label, isVpn: false });
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
