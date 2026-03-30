import { Router, type IRouter } from "express";
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
  getEnvCredentials,
  isPrivateIp,
  type RouterCredentials,
} from "../lib/mikrotik";
import {
  generateVpsOvpnSetupScript,
  describeVpnArchitecture,
} from "../lib/vpn-utils";
import { sbSelect, supabaseConfigured } from "../lib/supabase-client";
import { logger } from "../lib/logger";
import { readVpnClients, vpnIpFor } from "../lib/vpn-status";

const router: IRouter = Router();

/* ── Supabase isp_routers row shape ─────────────────────────────────────── */
interface SbRouter {
  id: number;
  name: string;
  host: string;
  bridge_ip: string | null;
  router_username: string;
  router_secret: string | null;
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
async function getRouterCreds(id: number): Promise<{ creds: RouterCredentials; row: SbRouter } | null> {
  if (!supabaseConfigured) return null;
  const rows = await sbSelect<SbRouter>(
    "isp_routers",
    `id=eq.${id}&select=id,name,host,bridge_ip,router_username,router_secret,status&limit=1`,
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
    warnings: [...warnings, ...result.warnings],
    ...result,
  });
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
 *   vpsIp           — VPS public IP (required — the OVPN server endpoint)
 *   vpnPort         — OVPN server port (default 1194)
 *   vpnUsername     — VPN user (default "admin")
 *   vpnPassword     — VPN password (default "ochola")
 *   tunnelRouterIp  — IP the VPS assigns to the router in the tunnel (default "10.8.0.2")
 *   tunnelVpsIp     — VPS tunnel IP (default "10.8.0.1")
 */
router.get("/router/:id/router-as-client", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }

  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found" }); return; }

  const vpsIp = String(req.query.vpsIp ?? "").trim();
  if (!vpsIp) {
    res.status(400).json({
      error:   "vpsIp is required",
      detail:  "Pass the public IP of your VPS (the OpenVPN server), e.g. ?vpsIp=102.212.246.73",
      example: `/api/router/${id}/router-as-client?vpsIp=102.212.246.73`,
    });
    return;
  }

  const script = generateRouterAsClientScript({
    vpsPublicIp:    vpsIp,
    routerId:       id,
    vpnPort:        req.query.vpnPort        ? parseInt(String(req.query.vpnPort),        10) : 1194,
    vpnUsername:    String(req.query.vpnUsername   ?? "admin"),
    vpnPassword:    String(req.query.vpnPassword   ?? "ochola"),
    tunnelRouterIp: String(req.query.tunnelRouterIp ?? "10.8.0.2"),
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
 *   vpsIp           — VPS public IP (informational, default "YOUR_VPS_IP")
 *   vpnPort         — OVPN port (default 1194)
 *   vpnUsername     — router VPN user (default "admin")
 *   vpnPassword     — router VPN password (default "ochola")
 *   tunnelRouterIp  — static IP to assign to router (default "10.8.0.2")
 */
router.get("/router/:id/vps-ovpn-setup", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid router id" }); return; }

  const found = await getRouterCreds(id);
  if (!found) { res.status(404).json({ error: "Router not found" }); return; }

  const vpsIp = String(req.query.vpsIp ?? "YOUR_VPS_IP").trim();

  const script = generateVpsOvpnSetupScript({
    vpsPublicIp:    vpsIp,
    routerId:       id,
    vpnPort:        req.query.vpnPort        ? parseInt(String(req.query.vpnPort),        10) : 1194,
    vpnUsername:    String(req.query.vpnUsername   ?? "admin"),
    vpnPassword:    String(req.query.vpnPassword   ?? "ochola"),
    tunnelBase:     String(req.query.tunnelBase     ?? "10.8.0"),
    routerTunnelIp: String(req.query.tunnelRouterIp ?? "10.8.0.2"),
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

  const vpsIp = String(req.query.vpsIp ?? "").trim();
  const info = describeVpnArchitecture({
    vpsPublicIp:    vpsIp || "SET_vpsIp_QUERY_PARAM",
    routerId:       id,
    vpnPort:        req.query.vpnPort ? parseInt(String(req.query.vpnPort), 10) : 1194,
    vpnUsername:    String(req.query.vpnUsername   ?? "admin"),
    routerTunnelIp: String(req.query.tunnelRouterIp ?? "10.8.0.2"),
  });

  res.json({
    routerId: id,
    routerName: found.row.name,
    configuredHost: found.row.host,
    bridgeIp: found.row.bridge_ip,
    scripts: {
      vpsSetup:       `/api/router/${id}/vps-ovpn-setup?vpsIp=${vpsIp || "YOUR_VPS_IP"}`,
      routerAsClient: `/api/router/${id}/router-as-client?vpsIp=${vpsIp || "YOUR_VPS_IP"}`,
      firewallScript: `/api/router/${id}/firewall-script?vpsIp=${vpsIp || "YOUR_VPS_IP"}`,
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
 *   vpnUsername   — VPN user to create (default "admin")
 *   vpnPassword   — VPN user password (default "ochola")
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

  const script = generateVpnSetupScript({
    routerPublicIp,
    routerId:      id,
    vpsIp:         String(req.query.vpsIp       ?? "").trim()   || undefined,
    vpnPort:       req.query.vpnPort       ? parseInt(String(req.query.vpnPort),       10) : 1194,
    vpnUsername:   String(req.query.vpnUsername  ?? "admin"),
    vpnPassword:   String(req.query.vpnPassword  ?? "ochola"),
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
 *   vpnUsername   — VPN user (default "admin")
 *   vpnPassword   — VPN user password (default "ochola")
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

  const config = generateOvpnClientConfig({
    routerPublicIp,
    vpnPort:        req.query.vpnPort     ? parseInt(String(req.query.vpnPort),     10) : 1194,
    vpnUsername:    String(req.query.vpnUsername  ?? "admin"),
    vpnPassword:    String(req.query.vpnPassword  ?? "ochola"),
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
  const creds: RouterCredentials = {
    host:     host.trim(),
    port:     port ?? 8728,
    username: username.trim(),
    password: password ?? "",
    useSSL:   (port ?? 8728) === 8729,
    bridgeIp: bridgeIp?.trim() || undefined,
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
