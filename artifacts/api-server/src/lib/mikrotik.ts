import { RouterOSAPI } from "node-routeros";
import { logger } from "./logger";

export interface RouterCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
}

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
}

function parseBytes(val: unknown): number {
  const n = parseInt(String(val ?? "0"), 10);
  return isNaN(n) ? 0 : n;
}

function parseBool(val: unknown): boolean {
  return String(val ?? "false").toLowerCase() !== "false";
}

function makeConn(creds: RouterCredentials): RouterOSAPI {
  return new RouterOSAPI({
    host: creds.host,
    port: creds.port || 8728,
    user: creds.username || "admin",
    password: creds.password || "",
    timeout: 10,
    keepalive: false,
  });
}

async function withTimeout<T>(promise: Promise<T>, ms = 12000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Router timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

/* ─── Fetch active hotspot users ─────────────────────────────────────────── */
export async function fetchHotspotUsers(creds: RouterCredentials): Promise<ActiveHotspotUser[]> {
  const conn = makeConn(creds);
  try {
    await withTimeout(conn.connect());
    const rows = await withTimeout(conn.write(["/ip/hotspot/active/print"])) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r[".id"] ?? "",
      user: r.user ?? "",
      address: r.address ?? "",
      macAddress: r["mac-address"] ?? "",
      uptime: r.uptime ?? "",
      bytesIn: parseBytes(r["bytes-in"]),
      bytesOut: parseBytes(r["bytes-out"]),
      server: r.server ?? "",
    }));
  } finally {
    try { conn.close(); } catch { /* ignore */ }
  }
}

/* ─── Fetch active PPPoE sessions ────────────────────────────────────────── */
export async function fetchPPPoEActive(creds: RouterCredentials): Promise<ActivePPPoESession[]> {
  const conn = makeConn(creds);
  try {
    await withTimeout(conn.connect());
    const rows = await withTimeout(conn.write(["/ppp/active/print"])) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r[".id"] ?? "",
      name: r.name ?? "",
      address: r.address ?? "",
      uptime: r.uptime ?? "",
      bytesIn: parseBytes(r["bytes-in"]),
      bytesOut: parseBytes(r["bytes-out"]),
      service: r.service ?? "",
    }));
  } finally {
    try { conn.close(); } catch { /* ignore */ }
  }
}

/* ─── Fetch interfaces ───────────────────────────────────────────────────── */
export async function fetchInterfaces(creds: RouterCredentials): Promise<RouterInterface[]> {
  const conn = makeConn(creds);
  try {
    await withTimeout(conn.connect());
    const rows = await withTimeout(conn.write(["/interface/print"])) as Record<string, string>[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r[".id"] ?? "",
      name: r.name ?? "",
      type: r.type ?? "",
      running: parseBool(r.running),
      disabled: parseBool(r.disabled),
      macAddress: r["mac-address"] ?? "",
      comment: r.comment ?? "",
      txBps: parseBytes(r["tx-byte"]),
      rxBps: parseBytes(r["rx-byte"]),
    }));
  } finally {
    try { conn.close(); } catch { /* ignore */ }
  }
}

/* ─── Fetch traffic stats (1-sample monitor) ────────────────────────────── */
export async function fetchTraffic(
  creds: RouterCredentials,
  interfaces: string[] = []
): Promise<TrafficStats[]> {
  const conn = makeConn(creds);
  try {
    await withTimeout(conn.connect());

    let ifaceNames = interfaces;
    if (ifaceNames.length === 0) {
      const rows = await withTimeout(conn.write(["/interface/print"])) as Record<string, string>[];
      ifaceNames = (Array.isArray(rows) ? rows : [])
        .filter((r) => parseBool(r.running) && !parseBool(r.disabled))
        .map((r) => r.name)
        .filter(Boolean)
        .slice(0, 8);
    }

    if (ifaceNames.length === 0) return [];

    const samples = await withTimeout(
      conn.write([
        "/interface/monitor-traffic",
        `=interface=${ifaceNames.join(",")}`,
        "=once=",
      ])
    ) as Record<string, string>[];

    return (Array.isArray(samples) ? samples : []).map((s, i) => ({
      iface: s.name ?? ifaceNames[i] ?? `iface${i}`,
      rxBitsPerSecond: parseBytes(s["rx-bits-per-second"]),
      txBitsPerSecond: parseBytes(s["tx-bits-per-second"]),
    }));
  } finally {
    try { conn.close(); } catch { /* ignore */ }
  }
}

/* ─── Fetch all live data in parallel ───────────────────────────────────── */
export async function fetchRouterLiveData(creds: RouterCredentials): Promise<RouterLiveData> {
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
  };
}
