import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import {
  fetchHotspotUsers,
  fetchPPPoEActive,
  fetchPPPSecrets,
  fetchPPPProfiles,
  addPPPSecret,
  removePPPSecret,
  updatePPPSecret,
  disconnectPPPActive,
  fetchInterfaces,
  fetchTraffic,
  fetchRouterLiveData,
  fetchWireless,
  setWirelessInterface,
  setWirelessSecurityProfile,
  testConnection,
  probeAllHosts,
  probePort,
  generateFirewallScript,
  generateVpnSetupScript,
  generateOvpnClientConfig,
  generateRouterAsClientScript,
  fetchRouterFiles,
  deployRouterFile,
  RouterFileExistsError,
  getEnvCredentials,
  isPrivateIp,
  type RouterCredentials,
} from "../lib/mikrotik";
import { getDeployableSource, type DeployableSourceType } from "./scripts-route.js";
import {
  generateVpsOvpnSetupScript,
  describeVpnArchitecture,
} from "../lib/vpn-utils";
import { sbSelect, supabaseConfigured } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { readVpnClients, vpnIpFor } from "../lib/vpn-status";

const router: IRouter = Router();

interface PendingRouterFileSource {
  content: Buffer;
  contentType: string;
  fileName: string;
  expiresAt: number;
}

const pendingRouterFileSources = new Map<string, PendingRouterFileSource>();
const ROUTER_FILE_SOURCE_TTL_MS = 5 * 60 * 1000;

function cleanPendingRouterFileSources(): void {
  const now = Date.now();
  for (const [token, source] of pendingRouterFileSources) {
    if (source.expiresAt <= now) pendingRouterFileSources.delete(token);
  }
}

function requestOrigin(req: import("express").Request): string {
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "")
    .split(",")[0]
    .trim();
  const requestHost = forwardedHost || req.get("host") || "";
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim();
  const requestHostname = requestHost.split(":")[0].toLowerCase();
  const isLocalHost = requestHostname === "localhost"
    || requestHostname === "127.0.0.1"
    || requestHostname === "0.0.0.0";
  /* Vite changes the proxy Host to localhost in development. Prefer the
     public Replit domain when it is available so a real router can reach the
     one-time source endpoint instead of trying to fetch from its own localhost. */
  const publicHost = isLocalHost && process.env.REPLIT_DEV_DOMAIN
    ? process.env.REPLIT_DEV_DOMAIN
    : requestHost;
  const protocol = forwardedProto === "https" || req.protocol === "https" || publicHost !== requestHost
    ? "https"
    : "http";
  return `${protocol}://${publicHost}`;
}

function vpnEndpointHost(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .replace(/:\d+$/, "")
    .trim();
}

function defaultTunnelRouterIp(routerId: number): string {
  /* Keep each router's default address distinct inside the VPS tunnel pool. */
  return `10.8.0.${2 + ((routerId - 1) % 240)}`;
}

function managedVpnPassword(row: SbRouter): string {
  const value = String(row.router_secret ?? row.token ?? "").trim();
  return /^[A-Za-z0-9_-]{20,128}$/.test(value) ? value : "";
}

function contentTypeForFile(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    css: "text/css; charset=utf-8",
    html: "text/html; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    svg: "image/svg+xml",
    txt: "text/plain; charset=utf-8",
    xsd: "application/xml",
    ico: "image/x-icon",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return contentTypes[extension ?? ""] ?? "application/octet-stream";
}

/* One-time source endpoint used by the router's /tool fetch command. The
   browser never receives this URL or the file contents, and the token is
   consumed on the first request. */
router.get("/router-file-source/:token", (req, res): void => {
  cleanPendingRouterFileSources();
  const token = req.params.token;
  const source = pendingRouterFileSources.get(token);
  if (!source || source.expiresAt <= Date.now()) {
    pendingRouterFileSources.delete(token);
    res.status(404).send("Upload source expired");
    return;
  }

  pendingRouterFileSources.delete(token);
  res
    .set("Content-Type", source.contentType)
    .set("Content-Length", String(source.content.length))
    .set("Content-Disposition", `inline; filename="${source.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`)
    .send(source.content);
});

/* ── Supabase isp_routers row shape ─────────────────────────────────────── */
interface SbRouter {
  id: number;
  name: string;
  host: string;
  bridge_ip: string | null;
  router_username: string;
  router_secret: string | null;
  token?: string | null;
  status: string;
}

/* ─── Build MikroTik credentials from a Supabase row ────────────────────── */
/**
 * Maps a Supabase isp_routers row to RouterCredentials.
 *
 * Connection strategy (priority order):
 *   1. creds.host    — should be public IP or VPN-reachable hostname
 *   2. creds.bridgeIp — VPN tunnel IP, used as automatic fallback
 *
 * Port / SSL:
 *   - Default: 8728 (plain API)
 *   - Set api_ssl=true in Supabase (future column) or use port 8729 prefix in host
 *   - Remote connections should use 8729 SSL when possible
 */
function rowToCreds(row: SbRouter): RouterCredentials {
  /* Prefer host (should be public IP); bridge_ip is VPN fallback */
  const primaryHost = row.host?.trim() || "";
  const vpnFallback = row.bridge_ip?.trim() || undefined;

  /* Auto-detect SSL: if host contains :8729 pattern or is explicitly set */
  const useSSL = false; /* Can be extended via Supabase column later */
  const port   = useSSL ? 8729 : 8728;

  return {
    host:     primaryHost,
    port,
    username: row.router_username || "admin",
    password: row.router_secret   || "",
    useSSL,
    bridgeIp: vpnFallback,
  };
}

/* ── VPN IP helper: true if IP is a VPN tunnel IP (10.8–11.x.x) ─────────── */
function isVpnTunnelIp(ip: string): boolean {
  return /^10\.(8|9|10|11)\.\d+\.\d+$/.test(ip);
}

/* ── True if IP is a LAN-only address unreachable from VPS ──────────────── */
function isLanOnlyIp(ip: string): boolean {
  return (
    /^192\.168\./.test(ip) ||
    /^10\.(?!8\.|9\.|10\.|11\.)/.test(ip) || /* 10.x.x.x but NOT VPN range */
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip)
  );
}

/* ─── Load credentials by Supabase isp_routers.id ───────────────────────── */
async function getRouterCreds(id: number, adminId?: number): Promise<{ creds: RouterCredentials; row: SbRouter } | null> {
  if (!supabaseConfigured) return null;
  const rows = await sbSelect<SbRouter>(
    "isp_routers",
    `id=eq.${id}${adminId !== undefined ? `&admin_id=eq.${adminId}` : ""}&select=id,name,host,bridge_ip,router_username,router_secret,token,status&limit=1`,
  );
  const row = rows[0];
  if (!row || (!row.host?.trim() && !row.bridge_ip?.trim())) return null;

  const creds = rowToCreds(row);

  /* ── VPN IP auto-injection ──────────────────────────────────────────────
     If bridge_ip is missing or is a LAN-only IP (unreachable from the VPS),
     look up the router's VPN tunnel IP from the OpenVPN server status file.
     This lets the backend connect via the VPN tunnel without any firewall
     rule changes on the router's WAN interface.
  ── */
  const bridgeIpUsable = creds.bridgeIp && isVpnTunnelIp(creds.bridgeIp);
  if (!bridgeIpUsable && creds.host) {
    const vpnClients = readVpnClients();
    /* Match by WAN IP (real IP seen by VPN server) */
    const autoVpnIp = vpnIpFor(creds.host, vpnClients)
      /* Also try matching by router name (certificate CN) */
      ?? vpnIpFor(row.name, vpnClients);
    if (autoVpnIp) {
      logger.info({ routerId: id, host: creds.host, vpnIp: autoVpnIp },
        "VPN IP auto-discovered from OpenVPN status — injecting as bridgeIp");
      creds.bridgeIp = autoVpnIp;
    }
  }

  return { creds, row };
}

/* ─── Load credentials by host IP ───────────────────────────────────────── */
async function getRouterCredsByHost(host: string): Promise<RouterCredentials | null> {
  if (!supabaseConfigured) return null;
  const rows = await sbSelect<SbRouter>(
    "isp_routers",
    `host=eq.${encodeURIComponent(host)}&select=id,name,host,bridge_ip,router_username,router_secret,status&limit=1`,
  );
  const row = rows[0];
  if (!row) return null;
  return rowToCreds(row);
}

/* ─── Graceful offline error ─────────────────────────────────────────────── */
function routerErrorResponse(res: import("express").Response, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const isOffline =
    msg.includes("timed out") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("EHOSTUNREACH") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("Cannot reach router");
  logger.warn({ err: msg }, "MikroTik API error");
  if (isOffline) {
    res.status(503).json({
      error:    "Router is offline or unreachable",
      detail:   msg,
      hint:     "Ensure the router's public IP is set, API port 8728/8729 is open, " +
                "and the VPS IP is allowed in the router's firewall. " +
                "If behind NAT, configure VPN tunnel and set bridge_ip.",
    });
  } else {
    res.status(500).json({ error: "MikroTik API error", detail: msg });
  }
}

/* ─── GET /api/router/env/live ──────────────────────────────────────────── */
router.get("/router/env/live", async (_req, res): Promise<void> => {
  const creds = getEnvCredentials();
  if (!creds) {
    res.status(503).json({
      error:  "Default router not configured",
      detail: "Set MIKROTIK_HOST and MIKROTIK_PASSWORD environment variables to enable this endpoint.",
    });
    return;
  }
  try {
    const data = await fetchRouterLiveData(creds);
    res.json({ source: "env", host: creds.host, ...data });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── GET /api/router/live-by-host?host=x.x.x.x ─────────────────────────── */
router.get("/router/live-by-host", async (req, res): Promise<void> => {
  const host = String(req.query.host ?? "").trim();
  if (!host) { res.status(400).json({ error: "host query param is required" }); return; }

  const dbCreds = await getRouterCredsByHost(host);
  if (dbCreds) {
    try {
      const data = await fetchRouterLiveData(dbCreds);
      res.json({ host, source: "supabase", ...data });
    } catch (err) {
      routerErrorResponse(res, err);
    }
    return;
  }

  const envCreds = getEnvCredentials();
  if (envCreds && envCreds.host === host) {
    try {
      const data = await fetchRouterLiveData(envCreds);
      res.json({ host, source: "env", ...data });
    } catch (err) {
      routerErrorResponse(res, err);
    }
    return;
  }

  res.status(404).json({
    error:  "Router not found",
    detail: `No credentials stored for host "${host}". Add the router in the Routers page first.`,
  });
});

/* ─── GET /api/router/:id/test ──────────────────────────────────────────── */
/**
 * Quick connectivity test — does NOT fetch live data, just attempts to connect.
 * Returns latency, SSL status, whether VPN fallback was used, and any warnings.
 */
router.get("/router/:id/test", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP configured" }); return; }

  const { creds, row } = found;
  const warnings: string[] = [];

  if (row.host && isPrivateIp(row.host)) {
    warnings.push(
      `Host ${row.host} is a private/local IP. The cloud API server cannot ` +
      `reach this address unless it is on the same network. ` +
      `Set the router's public IP or enable VPN and use bridge_ip as a tunnel address.`
    );
  }
  if (!row.host && row.bridge_ip) {
    warnings.push(
      `No public host configured — connecting via VPN tunnel IP ${row.bridge_ip}. ` +
      `For reliable remote access, set the router's public IP as the primary host.`
    );
  }

  const result = await testConnection(creds);
  res.status(result.ok ? 200 : 503).json({
    routerId: id,
    routerName: row.name,
    configuredHost: row.host,
    vpnFallbackIp: row.bridge_ip,
    ...result,
    warnings: [...warnings, ...result.warnings],
  });
});

/* ─── GET /api/router/:id/files ─────────────────────────────────────────── */
/**
 * Returns the file metadata currently stored on a selected MikroTik router.
 * The admin id is required so a router id cannot be used to inspect another
 * administrator's router.
 */
router.get("/router/:id/files", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const adminId = parseInt(String(req.query.adminId ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  if (isNaN(adminId)) { res.status(400).json({ error: "adminId query param is required" }); return; }

  const found = await getRouterCreds(id, adminId);
  if (!found) {
    res.status(404).json({ error: "Router not found or not assigned to this administrator" });
    return;
  }

  try {
    const result = await fetchRouterFiles(found.creds);
    res.json({
      routerId: id,
      routerName: found.row.name,
      files: result.files,
      count: result.files.length,
      connectedHost: result.connectedHost,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── POST /api/router/:id/files/deploy ──────────────────────────────────── */
/**
 * Publishes one allowlisted local hotspot asset or RouterOS script to a
 * selected router. The server owns both the local file read and router
 * credentials; the browser sends only an asset identifier and admin id.
 *
 * Body:
 *   { adminId, sourceType: "hotspot" | "script", sourceName,
 *     destinationDirectory? , destinationPath?, overwrite? }
 */
router.post("/router/:id/files/deploy", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const adminId = parseInt(String(req.body?.adminId ?? ""), 10);
  const sourceType = req.body?.sourceType as DeployableSourceType;
  const sourceName = String(req.body?.sourceName ?? "").trim();
  const overwrite = req.body?.overwrite === true;

  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  if (isNaN(adminId)) { res.status(400).json({ error: "adminId is required" }); return; }
  if (sourceType !== "hotspot" && sourceType !== "script") {
    res.status(400).json({ error: "sourceType must be hotspot or script" });
    return;
  }
  if (!sourceName) { res.status(400).json({ error: "sourceName is required" }); return; }

  const found = await getRouterCreds(id, adminId);
  if (!found) {
    res.status(404).json({ error: "Router not found or not assigned to this administrator" });
    return;
  }

  const source = getDeployableSource(sourceType, sourceName, requestOrigin(req));
  if (!source) {
    res.status(400).json({ error: "That local file is not an approved deployable source" });
    return;
  }

  let destinationPath: string;
  if (sourceType === "hotspot") {
    const directory = String(req.body?.destinationDirectory ?? "hotspot")
      .trim()
      .replaceAll("\\", "/")
      .replace(/^\/+|\/+$/g, "");
    if (!/^(?:(?:flash|disk1)\/)?hotspot$/i.test(directory)) {
      res.status(400).json({
        error: "Hotspot files must be deployed to hotspot, flash/hotspot, or disk1/hotspot",
      });
      return;
    }
    destinationPath = `${directory}/${source.source.name}`;
  } else {
    destinationPath = String(req.body?.destinationPath ?? source.source.name)
      .trim()
      .replaceAll("\\", "/");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.rsc$/i.test(destinationPath)) {
      res.status(400).json({
        error: "RouterOS scripts must use a simple .rsc filename without folders",
      });
      return;
    }
  }

  cleanPendingRouterFileSources();
  const token = randomBytes(24).toString("hex");
  pendingRouterFileSources.set(token, {
    content: source.content,
    contentType: contentTypeForFile(source.source.name),
    fileName: source.source.name.split("/").pop() ?? source.source.name,
    expiresAt: Date.now() + ROUTER_FILE_SOURCE_TTL_MS,
  });

  try {
    const result = await deployRouterFile(found.creds, {
      destinationPath,
      sourceUrl: `${requestOrigin(req)}/api/router-file-source/${token}`,
      overwrite,
      uploadId: token.slice(0, 16),
    });
    logger.info({
      routerId: id,
      adminId,
      sourceType,
      sourceName: source.source.name,
      destinationPath,
      replaced: result.replaced,
      size: result.size,
    }, "Router file deployed");
    res.status(201).json({
      ok: true,
      routerId: id,
      routerName: found.row.name,
      source: source.source,
      destinationPath: result.destinationPath,
      size: result.size,
      connectedHost: result.connectedHost,
      replaced: result.replaced,
    });
  } catch (err) {
    if (err instanceof RouterFileExistsError) {
      res.status(409).json({
        error: err.message,
        code: err.code,
        existingFile: {
          name: err.existingFile.name,
          type: err.existingFile.type,
          size: err.existingFile.size,
          creationTime: err.existingFile.creationTime,
        },
      });
      return;
    }
    routerErrorResponse(res, err);
  } finally {
    /* The source endpoint normally consumes this entry. Remove it here too
       when the router failed before making its fetch request. */
    pendingRouterFileSources.delete(token);
  }
});

/* ─── GET /api/router/:id/probe ─────────────────────────────────────────── */
/**
 * Runs a TCP port probe ONLY — no RouterOS API login attempt.
 * Returns per-host reachability, latency, and diagnosis.
 *
 * This is the fastest way to check if firewall/NAT is blocking the port
 * before wasting time on a full connection attempt.
 */
router.get("/router/:id/probe", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }

  const found = await getRouterCreds(id);
  if (!found) {
    res.status(404).json({ error: "Router not found or has no host/bridge_ip configured" });
    return;
  }

  const { creds, row } = found;
  const timeoutMs = parseInt(String(req.query.timeout ?? "6000"), 10);
  const probes    = await probeAllHosts(creds, Math.min(timeoutMs, 15000));

  const allOpen  = probes.every(p => p.reachable);
  const anyOpen  = probes.some(p => p.reachable);
  const warnings: string[] = [];

  if (row.host && isPrivateIp(row.host)) {
    warnings.push(
      `Host ${row.host} is a private/local IP. ` +
      `The cloud server cannot reach this unless it is on the same LAN.`
    );
  }

  res.status(anyOpen ? 200 : 503).json({
    routerId:   id,
    routerName: row.name,
    port:       creds.port,
    allOpen,
    anyOpen,
    warnings,
    hosts: probes.map(p => ({
      host:       p.host,
      reachable:  p.reachable,
      latencyMs:  p.latencyMs,
      diagnosis:  p.diagnosis,
      error:      p.error,
    })),
    summary: anyOpen
      ? `Port ${creds.port} is open on ${probes.filter(p => p.reachable).map(p => p.host).join(", ")}`
      : `Port ${creds.port} is NOT reachable on any configured host. ` +
        `Check the router firewall (/ip firewall filter) and ensure API service is enabled (/ip service).`,
  });
});

/* ─── GET /api/probe?host=x&port=8728 ───────────────────────────────────── */
/**
 * Ad-hoc port probe — no router record required.
 * Useful for testing arbitrary host:port pairs before adding a router.
 */
router.get("/probe", async (req, res): Promise<void> => {
  const host = String(req.query.host ?? "").trim();
  const port = parseInt(String(req.query.port ?? "8728"), 10);

  if (!host) {
    res.status(400).json({ error: "host query param required", example: "/api/probe?host=203.0.113.1&port=8728" });
    return;
  }
  if (isNaN(port) || port < 1 || port > 65535) {
    res.status(400).json({ error: "port must be 1–65535" });
    return;
  }

  const timeoutMs = parseInt(String(req.query.timeout ?? "6000"), 10);
  const probe = await probePort(host, port, Math.min(timeoutMs, 15000));

  const warnings: string[] = [];
  if (isPrivateIp(host)) {
    warnings.push(
      `${host} is a private/local IP. The cloud server cannot reach this ` +
      `unless it is on the same LAN. Use the router's public IP.`
    );
  }

  res.status(probe.reachable ? 200 : 503).json({
    host,
    port,
    reachable:  probe.reachable,
    latencyMs:  probe.latencyMs,
    diagnosis:  probe.diagnosis,
    error:      probe.error,
    warnings,
    summary:    probe.reachable
      ? `Port ${port} on ${host} is OPEN (${probe.latencyMs}ms)`
      : `Port ${port} on ${host} is NOT reachable: ${probe.diagnosis ?? probe.error}`,
  });
});

/* ─── GET /api/router/:id/router-as-client ──────────────────────────────── */
/**
 * CORRECT ARCHITECTURE for this setup:
 *   VPS = OpenVPN SERVER (already running, tun0 10.8.0.1)
 *   MikroTik = OpenVPN CLIENT (connects TO the VPS)
 *
 * Downloads a RouterOS script (.rsc) that configures the router as an OVPN client.
 * Import on the router: /import router-as-client<id>.rsc
 *
 * Query params:
 *   vpsIp           — VPS public IP (defaults to VPS_HOST)
 *   vpnPort         — OVPN server port (default 1194)
 *   vpnUsername     — VPN user (default "router-<id>")
 *   vpnPassword     — VPN password (defaults to the router's install secret)
 *   tunnelRouterIp  — IP the VPS assigns to the router in the tunnel
 *   tunnelVpsIp     — VPS tunnel IP (default "10.8.0.1")
 */
router.get("/router/:id/router-as-client", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }

  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found" }); return; }

  const vpsIp = vpnEndpointHost(req.query.vpsIp || process.env.VPS_HOST);
  if (!vpsIp) {
    res.status(400).json({
      error:   "VPS OpenVPN endpoint is not configured",
      detail:  "Set VPS_HOST or pass the public IP of the VPS with ?vpsIp=102.212.246.73",
      example: `/api/router/${id}/router-as-client?vpsIp=102.212.246.73`,
    });
    return;
  }

  const vpnUsername = String(req.query.vpnUsername ?? `router-${id}`).trim();
  const vpnPassword = managedVpnPassword(found.row);
  if (!vpnPassword) {
    res.status(409).json({
      error: "Router install secret is not available",
      detail: "Run the router registration/setup flow first so the VPN client can use a unique credential.",
    });
    return;
  }
  const tunnelRouterIp = String(req.query.tunnelRouterIp ?? defaultTunnelRouterIp(id)).trim();

  const script = generateRouterAsClientScript({
    vpsPublicIp:    vpsIp,
    routerId:       id,
    vpnPort:        req.query.vpnPort        ? parseInt(String(req.query.vpnPort),        10) : 1194,
    vpnUsername,
    vpnPassword,
    tunnelRouterIp,
    tunnelVpsIp:    String(req.query.tunnelVpsIp    ?? "10.8.0.1"),
  });

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="router-as-client${id}.rsc"`
  );
  res.send(script);
});

/* ─── GET /api/router/:id/vps-ovpn-setup ───────────────────────────────── */
/**
 * Downloads a bash script to run on the VPS as root.
 * Patches the existing OpenVPN server to accept MikroTik OVPN clients:
 *   - Switches to proto tcp
 *   - Disables tls-auth/tls-crypt (not supported by MikroTik)
 *   - Adds username/password auth for the router user
 *   - Assigns a static tunnel IP to the router
 *
 * Run on VPS: sudo bash vps-ovpn-setup<id>.sh
 *
 * Query params:
 *   vpsIp           — VPS public IP (default VPS_HOST)
 *   vpnPort         — OVPN port (default 1194)
 *   vpnUsername     — router VPN user (default "router-<id>")
 *   vpnPassword     — router VPN password (defaults to the router's install secret)
 *   tunnelRouterIp  — static IP to assign to router
 */
router.get("/router/:id/vps-ovpn-setup", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }

  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found" }); return; }

  const vpsIp = vpnEndpointHost(req.query.vpsIp || process.env.VPS_HOST);
  if (!vpsIp) {
    res.status(400).json({
      error: "VPS OpenVPN endpoint is not configured",
      detail: "Set VPS_HOST or pass the public IP of the VPS with ?vpsIp=102.212.246.73",
    });
    return;
  }

  const vpnUsername = String(req.query.vpnUsername ?? `router-${id}`).trim();
  const vpnPassword = managedVpnPassword(found.row);
  if (!vpnPassword) {
    res.status(409).json({
      error: "Router install secret is not available",
      detail: "Run the router registration/setup flow first so the VPS and router scripts share a unique credential.",
    });
    return;
  }
  const tunnelRouterIp = String(req.query.tunnelRouterIp ?? defaultTunnelRouterIp(id)).trim();

  const script = generateVpsOvpnSetupScript({
    vpsPublicIp:    vpsIp,
    routerId:       id,
    vpnPort:        req.query.vpnPort        ? parseInt(String(req.query.vpnPort),        10) : 1194,
    vpnUsername,
    vpnPassword,
    tunnelBase:     String(req.query.tunnelBase     ?? "10.8.0"),
    routerTunnelIp: tunnelRouterIp,
  });

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="vps-ovpn-setup${id}.sh"`
  );
  res.send(script);
});

/* ─── GET /api/router/:id/vpn-info ─────────────────────────────────────── */
/**
 * Returns a JSON summary of the VPN architecture and setup steps.
 * Use this to understand the setup before downloading the scripts.
 */
router.get("/router/:id/vpn-info", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }

  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found" }); return; }

  const vpsIp = vpnEndpointHost(req.query.vpsIp || process.env.VPS_HOST);
  const tunnelRouterIp = String(req.query.tunnelRouterIp ?? defaultTunnelRouterIp(id)).trim();
  const info = describeVpnArchitecture({
    vpsPublicIp:    vpsIp || "SET_VPS_HOST_OR_QUERY_PARAM",
    routerId:       id,
    vpnPort:        req.query.vpnPort ? parseInt(String(req.query.vpnPort), 10) : 1194,
    vpnUsername:    String(req.query.vpnUsername   ?? `router-${id}`),
    routerTunnelIp: tunnelRouterIp,
  });

  res.json({
    routerId: id,
    routerName: found.row.name,
    configuredHost: found.row.host,
    bridgeIp: found.row.bridge_ip,
    scripts: {
      vpsSetup:       `/api/router/${id}/vps-ovpn-setup${vpsIp ? `?vpsIp=${encodeURIComponent(vpsIp)}` : ""}`,
      routerAsClient: `/api/router/${id}/router-as-client${vpsIp ? `?vpsIp=${encodeURIComponent(vpsIp)}` : ""}`,
      firewallScript: `/api/router/${id}/firewall-script${vpsIp ? `?vpsIp=${encodeURIComponent(vpsIp)}` : ""}`,
    },
    ...info,
  });
});

/* ─── GET /api/router/:id/vpn-setup-script ──────────────────────────────── */
/**
 * Generates a MikroTik RouterOS script (.rsc) that sets up an OpenVPN
 * server and creates the default VPN/API admin user on the router.
 *
 * Download and run on the router:
 *   /import ovpn-setup-router<id>.rsc
 *
 * Query params (all optional):
 *   vpsIp         — VPS IP to restrict OVPN access (recommended)
 *   vpnPort       — OVPN port on router (default 1194)
 *   vpnUsername   — VPN user to create (default "router-<id>")
 *   VPN credentials are derived from the router's stored install secret.
 *   tunnelNetwork — first 3 octets of VPN tunnel subnet (default "192.168.89")
 *   lanNetwork    — router LAN CIDR VPN clients can access (default "192.168.88.0/24")
 */
router.get("/router/:id/vpn-setup-script", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }

  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found" }); return; }

  const { row } = found;
  /* Prefer the stored public host; fall back to bridge_ip if no public host */
  const routerPublicIp = (row.host?.trim() && !isPrivateIp(row.host))
    ? row.host.trim()
    : (row.bridge_ip?.trim() || row.host?.trim() || "YOUR_ROUTER_PUBLIC_IP");
  const vpnUsername = String(req.query.vpnUsername ?? `router-${id}`).trim();
  const vpnPassword = managedVpnPassword(row);
  if (!vpnPassword) {
    res.status(409).json({
      error: "Router install secret is not available",
      detail: "Run the router registration/setup flow first or pass an explicit VPN credential.",
    });
    return;
  }

  const script = generateVpnSetupScript({
    routerPublicIp,
    routerId:      id,
    vpsIp:         String(req.query.vpsIp       ?? "").trim()   || undefined,
    vpnPort:       req.query.vpnPort       ? parseInt(String(req.query.vpnPort),       10) : 1194,
    vpnUsername,
    vpnPassword,
    tunnelNetwork: String(req.query.tunnelNetwork ?? "192.168.89"),
    lanNetwork:    String(req.query.lanNetwork    ?? "192.168.88.0/24"),
  });

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="ovpn-setup-router${id}.rsc"`
  );
  res.send(script);
});

/* ─── GET /api/router/:id/ovpn-client ──────────────────────────────────── */
/**
 * Generates the .ovpn client configuration file for the VPS to connect
 * to this router's OpenVPN server.
 *
 * Save on the VPS and run:
 *   openvpn --config /etc/openvpn/router-admin.ovpn --daemon
 *
 * Query params (all optional):
 *   vpnPort       — OVPN port on router (default 1194)
 *   vpnUsername   — VPN user (default "router-<id>")
 *   VPN credentials are derived from the router's stored install secret.
 *   routeAll      — "true" to route ALL traffic through VPN (default: split)
 *   lanNetwork    — LAN to route through tunnel (default "192.168.88.0/24")
 */
router.get("/router/:id/ovpn-client", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }

  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found" }); return; }

  const { row } = found;
  const routerPublicIp = (row.host?.trim() && !isPrivateIp(row.host))
    ? row.host.trim()
    : (row.bridge_ip?.trim() || row.host?.trim() || "YOUR_ROUTER_PUBLIC_IP");
  const vpnUsername = String(req.query.vpnUsername ?? `router-${id}`).trim();
  const vpnPassword = managedVpnPassword(row);
  if (!vpnPassword) {
    res.status(409).json({
      error: "Router install secret is not available",
      detail: "Run the router registration/setup flow first or pass an explicit VPN credential.",
    });
    return;
  }

  const config = generateOvpnClientConfig({
    routerPublicIp,
    vpnPort:        req.query.vpnPort     ? parseInt(String(req.query.vpnPort),     10) : 1194,
    vpnUsername,
    vpnPassword,
    lanNetwork:     String(req.query.lanNetwork   ?? "192.168.88.0/24"),
    routeAll:       req.query.routeAll === "true",
  });

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="router${id}-admin.ovpn"`
  );
  res.send(config);
});

/* ─── GET /api/router/:id/firewall-script?vpsIp=x.x.x.x ────────────────── */
/**
 * Generates a MikroTik RouterOS firewall script that restricts API access
 * to the VPS IP only. Download and paste into the router terminal.
 *
 * Query params:
 *   vpsIp  — IP of the VPS/server that runs this backend (required)
 *   ssl    — "true" to include port 8729 (API-SSL) rules (default: true)
 */
router.get("/router/:id/firewall-script", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }

  const vpsIp = String(req.query.vpsIp ?? "").trim();
  if (!vpsIp) {
    res.status(400).json({
      error:  "vpsIp query parameter is required",
      detail: "Pass the public IP of your VPS server, e.g. ?vpsIp=203.0.113.42",
    });
    return;
  }

  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found" }); return; }

  const enableApiSsl = req.query.ssl !== "false";
  const script = generateFirewallScript(vpsIp, {
    enableApiSsl,
    comment: `ISP-${id}`,
  });

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="mikrotik-firewall-router${id}.rsc"`
  );
  res.send(script);
});

/* ─── GET /api/router/:id/hotspot ──────────────────────────────────────── */
router.get("/router/:id/hotspot", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    const users = await fetchHotspotUsers(found.creds);
    res.json({ routerId: id, users, fetchedAt: new Date().toISOString() });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── GET /api/router/:id/pppoe ─────────────────────────────────────────── */
router.get("/router/:id/pppoe", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    const sessions = await fetchPPPoEActive(found.creds);
    res.json({ routerId: id, sessions, fetchedAt: new Date().toISOString() });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── GET /api/router/:id/interfaces ──────────────────────────────────── */
router.get("/router/:id/interfaces", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    const interfaces = await fetchInterfaces(found.creds);
    res.json({ routerId: id, interfaces, fetchedAt: new Date().toISOString() });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── GET /api/router/:id/traffic ──────────────────────────────────────── */
router.get("/router/:id/traffic", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    const ifaces = req.query.ifaces ? String(req.query.ifaces).split(",").filter(Boolean) : [];
    const traffic = await fetchTraffic(found.creds, ifaces);
    res.json({ routerId: id, traffic, fetchedAt: new Date().toISOString() });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── GET /api/router/:id/live ─────────────────────────────────────────── */
router.get("/router/:id/live", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    const data = await fetchRouterLiveData(found.creds);
    res.json({ routerId: id, ...data });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── GET /api/router/:id/wireless ─────────────────────────────────────── */
router.get("/router/:id/wireless", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    const data = await fetchWireless(found.creds);
    res.json({ routerId: id, ...data });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── PATCH /api/router/:id/wireless ───────────────────────────────────── */
/* Body: { interfaceId, ssid?, profileId?, password? } */
router.patch("/router/:id/wireless", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }

  const { interfaceId, ssid, profileId, password } = req.body as {
    interfaceId?: string;
    ssid?: string;
    profileId?: string;
    password?: string;
  };

  if (!interfaceId) { res.status(400).json({ error: "interfaceId is required" }); return; }

  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }

  try {
    if (ssid !== undefined) {
      await setWirelessInterface(found.creds, interfaceId, { ssid });
    }
    if (profileId !== undefined && password !== undefined) {
      await setWirelessSecurityProfile(found.creds, profileId, { password });
    }
    res.json({ ok: true, message: "Wireless settings updated" });
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ─── POST /api/router/test-raw — test raw credentials before saving ───── */
router.post("/router/test-raw", async (req, res): Promise<void> => {
  const { host, port, username, password, bridgeIp } = req.body as {
    host: string; port?: number; username: string; password: string; bridgeIp?: string;
  };
  if (!host || !username) {
    res.status(400).json({ error: "host and username are required" });
    return;
  }

  /* Auto-resolve VPN tunnel IP from the OpenVPN status file.
     If bridgeIp is already a VPN IP (10.8.x.x) use it as-is.
     Otherwise look up the tunnel IP by the router's WAN/host IP so
     withConn() can try the VPN path first (avoids 6-second WAN timeout). */
  const isVpnAddr = (ip: string) => /^10\.8\./.test(ip);
  let resolvedBridgeIp = bridgeIp?.trim() || undefined;
  if (!resolvedBridgeIp || !isVpnAddr(resolvedBridgeIp)) {
    const vpnClients = readVpnClients();
    const found = vpnIpFor(host.trim(), vpnClients);
    if (found) resolvedBridgeIp = found;
  }

  const creds: RouterCredentials = {
    host:     host.trim(),
    port:     port ?? 8728,
    username: username.trim(),
    password: password ?? "",
    useSSL:   (port ?? 8728) === 8729,
    bridgeIp: resolvedBridgeIp,
  };
  try {
    const result = await testConnection(creds);
    res.status(result.ok ? 200 : 503).json(result);
  } catch (err) {
    routerErrorResponse(res, err);
  }
});

/* ══════════════════════ PPP Secrets ════════════════════════════════════════ */

/* GET /api/router/:id/ppp/secrets */
router.get("/router/:id/ppp/secrets", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    const secrets = await fetchPPPSecrets(found.creds);
    res.json({ routerId: id, secrets, fetchedAt: new Date().toISOString() });
  } catch (err) { routerErrorResponse(res, err); }
});

/* POST /api/router/:id/ppp/secrets — add a new PPP user */
router.post("/router/:id/ppp/secrets", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const { name, password, profile, service, comment } = req.body as {
    name: string; password: string; profile?: string; service?: string; comment?: string;
  };
  if (!name || !password) { res.status(400).json({ error: "name and password are required" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    await addPPPSecret(found.creds, { name, password, profile, service, comment });
    res.json({ ok: true, message: `PPP secret '${name}' created` });
  } catch (err) { routerErrorResponse(res, err); }
});

/* PATCH /api/router/:id/ppp/secrets/:secretId — update password/profile/disabled */
router.patch("/router/:id/ppp/secrets/:secretId", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const secretId = req.params.secretId;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const { password, profile, disabled, comment } = req.body as {
    password?: string; profile?: string; disabled?: boolean; comment?: string;
  };
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    await updatePPPSecret(found.creds, secretId, { password, profile, disabled, comment });
    res.json({ ok: true, message: "PPP secret updated" });
  } catch (err) { routerErrorResponse(res, err); }
});

/* DELETE /api/router/:id/ppp/secrets/:secretId */
router.delete("/router/:id/ppp/secrets/:secretId", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const secretId = req.params.secretId;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    await removePPPSecret(found.creds, secretId);
    res.json({ ok: true, message: "PPP secret deleted" });
  } catch (err) { routerErrorResponse(res, err); }
});

/* GET /api/router/:id/ppp/profiles */
router.get("/router/:id/ppp/profiles", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    const profiles = await fetchPPPProfiles(found.creds);
    res.json({ routerId: id, profiles, fetchedAt: new Date().toISOString() });
  } catch (err) { routerErrorResponse(res, err); }
});

/* DELETE /api/router/:id/ppp/active/:sessionId — disconnect a PPP session */
router.delete("/router/:id/ppp/active/:sessionId", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const sessionId = req.params.sessionId;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }
  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found or has no IP" }); return; }
  try {
    await disconnectPPPActive(found.creds, sessionId);
    res.json({ ok: true, message: "Session disconnected" });
  } catch (err) { routerErrorResponse(res, err); }
});

export default router;
