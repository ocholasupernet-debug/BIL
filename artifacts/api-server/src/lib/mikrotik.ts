import { RouterOSAPI } from "node-routeros";
import { logger } from "./logger";

/* ─── Credential types ───────────────────────────────────────────────────── */

export interface RouterCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Use SSL (API-SSL, port 8729). Auto-enabled when port === 8729. */
  useSSL?: boolean;
}

/* ─── Environment-variable credentials ──────────────────────────────────── */

/**
 * Reads the "default" router credentials from environment variables.
 * Returns null if MIKROTIK_HOST is not set.
 *
 * Required:
 *   MIKROTIK_HOST      — router IP or hostname
 *   MIKROTIK_PASSWORD  — API password (store as a secret, never hardcode)
 *
 * Optional:
 *   MIKROTIK_USERNAME  — API username (default: "admin")
 *   MIKROTIK_PORT      — API port    (default: 8728 plain / 8729 SSL)
 *   MIKROTIK_USE_SSL   — "true" to use API-SSL (port 8729 + TLS)
 */
export function getEnvCredentials(): RouterCredentials | null {
  const host = process.env["MIKROTIK_HOST"]?.trim();
  if (!host) return null;

  const password = process.env["MIKROTIK_PASSWORD"] ?? "";
  const username = process.env["MIKROTIK_USERNAME"] ?? "admin";
  const useSSL   = process.env["MIKROTIK_USE_SSL"]?.toLowerCase() === "true";
  const rawPort  = process.env["MIKROTIK_PORT"];
  const port     = rawPort ? parseInt(rawPort, 10) : useSSL ? 8729 : 8728;

  if (!password) {
    logger.warn("MIKROTIK_PASSWORD is not set — connection will likely fail");
  }

  return { host, port, username, password, useSSL: useSSL || port === 8729 };
}

/* ─── Connection factory ─────────────────────────────────────────────────── */

function makeConn(creds: RouterCredentials): RouterOSAPI {
  const ssl = creds.useSSL ?? creds.port === 8729;
  return new RouterOSAPI({
    host:     creds.host,
    port:     creds.port,
    user:     creds.username,
    password: creds.password,
    timeout:  10,
    keepalive: false,
    ...(ssl
      ? {
          tls: {
            /* RouterOS ships with self-signed certs by default.
               Set MIKROTIK_TLS_VERIFY=true in production if you have
               a proper certificate installed on the router.           */
            rejectUnauthorized: process.env["MIKROTIK_TLS_VERIFY"] === "true",
          },
        }
      : {}),
  });
}

async function withTimeout<T>(promise: Promise<T>, ms = 12000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Router timed out after ${ms / 1000}s`)),
        ms
      )
    ),
  ]);
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
  const conn = makeConn(creds);
  try {
    await withTimeout(conn.connect());
    const rows = (await withTimeout(
      conn.write(["/ip/hotspot/active/print"])
    )) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id:         r[".id"]          ?? "",
      user:       r.user            ?? "",
      address:    r.address         ?? "",
      macAddress: r["mac-address"]  ?? "",
      uptime:     r.uptime          ?? "",
      bytesIn:    parseBytes(r["bytes-in"]),
      bytesOut:   parseBytes(r["bytes-out"]),
      server:     r.server          ?? "",
    }));
  } finally {
    try { conn.close(); } catch { /* ignore */ }
  }
}

export async function fetchPPPoEActive(
  creds: RouterCredentials
): Promise<ActivePPPoESession[]> {
  const conn = makeConn(creds);
  try {
    await withTimeout(conn.connect());
    const rows = (await withTimeout(
      conn.write(["/ppp/active/print"])
    )) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id:       r[".id"]         ?? "",
      name:     r.name           ?? "",
      address:  r.address        ?? "",
      uptime:   r.uptime         ?? "",
      bytesIn:  parseBytes(r["bytes-in"]),
      bytesOut: parseBytes(r["bytes-out"]),
      service:  r.service        ?? "",
    }));
  } finally {
    try { conn.close(); } catch { /* ignore */ }
  }
}

export async function fetchInterfaces(
  creds: RouterCredentials
): Promise<RouterInterface[]> {
  const conn = makeConn(creds);
  try {
    await withTimeout(conn.connect());
    const rows = (await withTimeout(
      conn.write(["/interface/print"])
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
  } finally {
    try { conn.close(); } catch { /* ignore */ }
  }
}

export async function fetchTraffic(
  creds: RouterCredentials,
  interfaces: string[] = []
): Promise<TrafficStats[]> {
  const conn = makeConn(creds);
  try {
    await withTimeout(conn.connect());

    let ifaceNames = interfaces;
    if (ifaceNames.length === 0) {
      const rows = (await withTimeout(
        conn.write(["/interface/print"])
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
      ])
    )) as Record<string, string>[];

    return (Array.isArray(samples) ? samples : []).map((s, i) => ({
      iface:            s.name            ?? ifaceNames[i] ?? `iface${i}`,
      rxBitsPerSecond:  parseBytes(s["rx-bits-per-second"]),
      txBitsPerSecond:  parseBytes(s["tx-bits-per-second"]),
    }));
  } finally {
    try { conn.close(); } catch { /* ignore */ }
  }
}

/* ─── Combined fetch ─────────────────────────────────────────────────────── */

export async function fetchRouterLiveData(
  creds: RouterCredentials
): Promise<RouterLiveData> {
  const usingSSL = creds.useSSL ?? creds.port === 8729;

  const [hotspotUsers, pppoeUsers, interfaces] = await Promise.all([
    fetchHotspotUsers(creds).catch((e) => {
      logger.warn({ err: e.message }, "fetchHotspotUsers failed");
      return [] as ActiveHotspotUser[];
    }),
    fetchPPPoEActive(creds).catch((e) => {
      logger.warn({ err: e.message }, "fetchPPPoEActive failed");
      return [] as ActivePPPoESession[];
    }),
    fetchInterfaces(creds).catch((e) => {
      logger.warn({ err: e.message }, "fetchInterfaces failed");
      return [] as RouterInterface[];
    }),
  ]);

  const runningIfaces = interfaces
    .filter((i) => i.running && !i.disabled)
    .map((i) => i.name)
    .slice(0, 8);

  const traffic = await fetchTraffic(creds, runningIfaces).catch((e) => {
    logger.warn({ err: e.message }, "fetchTraffic failed");
    return [] as TrafficStats[];
  });

  return {
    hotspotUsers,
    pppoeUsers,
    interfaces,
    traffic,
    fetchedAt: new Date().toISOString(),
    usingSSL,
  };
}
