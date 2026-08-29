import { randomBytes } from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  deployRouterFile,
  runRouterScript,
  type RouterCredentials,
} from "../lib/mikrotik.js";
import {
  buildLoadBalancingScript,
  DEFAULT_LOAD_BALANCING_CONFIG,
  validateLoadBalancingConfig,
  type LoadBalancingConfig,
  type LoadBalancingWan,
} from "../lib/router-load-balancing.js";
import {
  sbDeleteStrict,
  sbInsertStrict,
  sbSelectStrict,
  sbUpsertStrict,
} from "../lib/supabase-client.js";

const router: IRouter = Router();
const SOURCE_TTL_MS = 5 * 60 * 1000;

interface StoredRouter {
  id: number;
  admin_id: number;
  name: string;
  host: string | null;
  vpn_ip: string | null;
  router_username: string | null;
  router_secret: string | null;
  ros_version: string | null;
}

interface StoredConfig {
  id: number;
  admin_id: number;
  router_id: number;
  enabled: boolean;
  lan_interface: string;
  router_os_version: "auto" | "6" | "7";
}

interface StoredWan {
  id: number;
  load_balancing_id: number;
  name: string;
  interface_name: string;
  gateway: string;
  weight: number;
  health_check_ip: string;
  enabled: boolean;
  position: number;
}

interface PendingSource {
  content: Buffer;
  expiresAt: number;
}

const pendingSources = new Map<string, PendingSource>();

function cleanSources(): void {
  const now = Date.now();
  for (const [token, source] of pendingSources) {
    if (source.expiresAt <= now) pendingSources.delete(token);
  }
}

function requestOrigin(req: Request): string {
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim();
  const requestHost = forwardedHost || req.get("host") || "";
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const hostname = requestHost.split(":")[0].toLowerCase();
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
  const publicHost = local && process.env.REPLIT_DEV_DOMAIN ? process.env.REPLIT_DEV_DOMAIN : requestHost;
  const protocol = forwardedProto === "https" || req.protocol === "https" || publicHost !== requestHost ? "https" : "http";
  return `${protocol}://${publicHost}`;
}

function adminIdFrom(req: Request): number {
  const raw = req.body?.adminId ?? req.query.adminId;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

async function findRouter(routerId: number, adminId: number): Promise<StoredRouter | null> {
  const rows = await sbSelectStrict<StoredRouter>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,admin_id,name,host,vpn_ip,router_username,router_secret,ros_version&limit=1`,
  );
  return rows[0] ?? null;
}

function routerCredentials(row: StoredRouter): RouterCredentials {
  const host = row.host?.trim() || row.vpn_ip?.trim() || "";
  return {
    host,
    port: 8728,
    username: row.router_username?.trim() || "admin",
    password: row.router_secret ?? "",
    useSSL: false,
    bridgeIp: row.vpn_ip?.trim() || undefined,
    connectTimeoutMs: 8_000,
    requestTimeoutMs: 15_000,
  };
}

async function loadStoredConfig(
  routerId: number,
  adminId: number,
): Promise<LoadBalancingConfig> {
  const rows = await sbSelectStrict<StoredConfig>(
    "isp_router_load_balancing",
    `router_id=eq.${routerId}&admin_id=eq.${adminId}&select=id,admin_id,router_id,enabled,lan_interface,router_os_version&limit=1`,
  );
  const row = rows[0];
  if (!row) {
    return {
      ...DEFAULT_LOAD_BALANCING_CONFIG,
      routerId,
      adminId,
      wans: [],
    };
  }
  const wans = await sbSelectStrict<StoredWan>(
    "isp_router_load_balancing_wans",
    `load_balancing_id=eq.${row.id}&admin_id=eq.${adminId}&select=id,load_balancing_id,name,interface_name,gateway,weight,health_check_ip,enabled,position&order=position.asc`,
  );
  return {
    routerId,
    adminId,
    enabled: row.enabled,
    lanInterface: row.lan_interface,
    routerOsVersion: row.router_os_version,
    wans: wans.map(wan => ({
      id: wan.id,
      name: wan.name,
      interfaceName: wan.interface_name,
      gateway: wan.gateway,
      weight: wan.weight,
      healthCheckIp: wan.health_check_ip,
      enabled: wan.enabled,
      position: wan.position,
    })),
  };
}

function validateInput(req: Request, routerId: number, adminId: number): LoadBalancingConfig {
  const result = validateLoadBalancingConfig(req.body, routerId, adminId);
  if (result.errors.length || !result.config) {
    const error = new Error(result.errors.join(" ") || "Invalid load-balancing configuration.");
    (error as Error & { status?: number }).status = 400;
    throw error;
  }
  return result.config;
}

async function persistConfig(config: LoadBalancingConfig): Promise<LoadBalancingConfig> {
  const [saved] = await sbUpsertStrict<StoredConfig>(
    "isp_router_load_balancing",
    "admin_id,router_id",
    {
      admin_id: config.adminId,
      router_id: config.routerId,
      enabled: config.enabled,
      lan_interface: config.lanInterface,
      router_os_version: config.routerOsVersion,
      updated_at: new Date().toISOString(),
    },
  );
  if (!saved) throw new Error("Load-balancing settings could not be saved.");

  await sbDeleteStrict(
    "isp_router_load_balancing_wans",
    `load_balancing_id=eq.${saved.id}&admin_id=eq.${config.adminId}`,
  );
  if (config.wans.length) {
    const rows = config.wans.map((wan: LoadBalancingWan, position) => ({
      load_balancing_id: saved.id,
      admin_id: config.adminId,
      name: wan.name,
      interface_name: wan.interfaceName,
      gateway: wan.gateway,
      weight: wan.weight,
      health_check_ip: wan.healthCheckIp,
      enabled: wan.enabled,
      position,
      updated_at: new Date().toISOString(),
    }));
    await sbInsertStrict("isp_router_load_balancing_wans", rows);
  }
  return { ...config, wans: config.wans.map((wan, position) => ({ ...wan, position })) };
}

function responseFor(config: LoadBalancingConfig, routerVersion?: string | null) {
  const generated = buildLoadBalancingScript(config, routerVersion);
  return {
    ok: true,
    config,
    script: generated.script,
    effectiveVersion: generated.effectiveVersion,
    activeWanCount: generated.activeWanCount,
    totalWeight: generated.totalWeight,
  };
}

function sendError(res: Response, error: unknown): void {
  const status = error && typeof error === "object" && "status" in error
    ? Number((error as { status?: number }).status)
    : 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    ok: false,
    error: error instanceof Error ? error.message : "Load-balancing request failed.",
  });
}

router.get("/router-load-balancing-source/:token", (req, res): void => {
  cleanSources();
  const source = pendingSources.get(req.params.token);
  if (!source || source.expiresAt <= Date.now()) {
    pendingSources.delete(req.params.token);
    res.status(404).send("Upload source expired");
    return;
  }
  pendingSources.delete(req.params.token);
  res.type("text/plain").send(source.content);
});

router.get("/router/:id/load-balancing", async (req, res): Promise<void> => {
  const routerId = Number(req.params.id);
  const adminId = adminIdFrom(req);
  if (!Number.isInteger(routerId) || routerId <= 0 || !adminId) {
    res.status(400).json({ ok: false, error: "A valid router id and admin id are required." });
    return;
  }
  try {
    const row = await findRouter(routerId, adminId);
    if (!row) {
      res.status(404).json({ ok: false, error: "Router not found for this ISP account." });
      return;
    }
    res.json(responseFor(await loadStoredConfig(routerId, adminId), row.ros_version));
  } catch (error) {
    sendError(res, error);
  }
});

router.put("/router/:id/load-balancing", async (req, res): Promise<void> => {
  const routerId = Number(req.params.id);
  const adminId = adminIdFrom(req);
  if (!Number.isInteger(routerId) || routerId <= 0 || !adminId) {
    res.status(400).json({ ok: false, error: "A valid router id and admin id are required." });
    return;
  }
  try {
    const row = await findRouter(routerId, adminId);
    if (!row) {
      res.status(404).json({ ok: false, error: "Router not found for this ISP account." });
      return;
    }
    const config = await persistConfig(validateInput(req, routerId, adminId));
    res.json(responseFor(config, row.ros_version));
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/router/:id/load-balancing/preview", async (req, res): Promise<void> => {
  const routerId = Number(req.params.id);
  const adminId = adminIdFrom(req);
  if (!Number.isInteger(routerId) || routerId <= 0 || !adminId) {
    res.status(400).json({ ok: false, error: "A valid router id and admin id are required." });
    return;
  }
  try {
    const row = await findRouter(routerId, adminId);
    if (!row) {
      res.status(404).json({ ok: false, error: "Router not found for this ISP account." });
      return;
    }
    res.json(responseFor(validateInput(req, routerId, adminId), row.ros_version));
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/router/:id/load-balancing/apply", async (req, res): Promise<void> => {
  const routerId = Number(req.params.id);
  const adminId = adminIdFrom(req);
  if (!Number.isInteger(routerId) || routerId <= 0 || !adminId) {
    res.status(400).json({ ok: false, error: "A valid router id and admin id are required." });
    return;
  }
  if (req.body?.confirm !== true) {
    res.status(400).json({ ok: false, error: "Explicit confirmation is required before applying router changes." });
    return;
  }
  let token = "";
  try {
    const row = await findRouter(routerId, adminId);
    if (!row) {
      res.status(404).json({ ok: false, error: "Router not found for this ISP account." });
      return;
    }
    const config = validateInput(req, routerId, adminId);
    if (!config.enabled || config.wans.filter(wan => wan.enabled).length < 2) {
      res.status(400).json({ ok: false, error: "Enable load balancing and at least two WAN links before applying." });
      return;
    }
    const saved = await persistConfig(config);
    const generated = buildLoadBalancingScript(saved, row.ros_version);
    const credentials = routerCredentials(row);
    if (!credentials.host) {
      res.status(409).json({ ok: false, error: "This router has no public or management VPN address configured." });
      return;
    }

    cleanSources();
    token = randomBytes(24).toString("hex");
    pendingSources.set(token, {
      content: Buffer.from(generated.script, "utf8"),
      expiresAt: Date.now() + SOURCE_TTL_MS,
    });
    const fileName = "ochola-load-balancing.rsc";
    const upload = await deployRouterFile(credentials, {
      destinationPath: fileName,
      sourceUrl: `${requestOrigin(req)}/api/router-load-balancing-source/${token}`,
      overwrite: true,
      uploadId: token.slice(0, 16),
    });
    await runRouterScript(credentials, fileName);
    res.json({
      ...responseFor(saved, row.ros_version),
      applied: true,
      routerName: row.name,
      connectedHost: upload.connectedHost,
      destinationPath: upload.destinationPath,
    });
  } catch (error) {
    sendError(res, error);
  } finally {
    if (token) pendingSources.delete(token);
  }
});

export default router;