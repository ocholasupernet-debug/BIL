import { Router, type IRouter, type Request, type Response } from "express";
import { sbSelect, sbUpdate, sbDelete, sbInsert } from "../lib/supabase-client.js";
import { pingRouter } from "../lib/mikrotik.js";
import { logger } from "../lib/logger.js";
import { logActivity } from "../lib/activity-log.js";

const router: IRouter = Router();

/*
 * /api/routers — thin proxy to Supabase isp_routers.
 * The frontend Routers.tsx page writes to Supabase directly; this route is
 * used by server-side flows (e.g. BridgePorts credential lookup) and any
 * integrations that prefer the REST API over the Supabase JS SDK.
 *
 * Query param:  adminId (preferred) or ispId (alias) — filters by admin_id
 */

router.get("/routers", async (req, res): Promise<void> => {
  const adminId = req.query.adminId ?? req.query.ispId ?? "1";
  const rows = await sbSelect(
    "isp_routers",
    `admin_id=eq.${adminId}&select=id,name,host,bridge_ip,bridge_interface,router_username,status,last_seen,model,ros_version,ip_address`,
  );
  res.json(rows);
});

router.post("/routers", async (req, res): Promise<void> => {
  const { adminId = 1, ispId, name, host, ipAddress, model, rosVersion, apiPort, router_username, apiUsername, router_secret, apiPassword, bridge_ip, status } = req.body;
  const effectiveAdminId = adminId || ispId || 1;
  if (!name || !host) {
    res.status(400).json({ error: "name and host are required" });
    return;
  }
  const [r] = await sbInsert<Record<string, unknown>>("isp_routers", {
    admin_id:         effectiveAdminId,
    name,
    host:             host || ipAddress || "",
    model:            model ?? null,
    ros_version:      rosVersion ?? null,
    router_username:  router_username || apiUsername || "admin",
    router_secret:    router_secret  || apiPassword  || null,
    bridge_ip:        bridge_ip ?? null,
    status:           status ?? "offline",
  });
  if (!r) { res.status(500).json({ error: "Failed to create router" }); return; }
  void logActivity({ adminId: Number(effectiveAdminId), type: "router", action: "added", subject: name, details: { host: host || ipAddress } });
  res.status(201).json(r);
});

router.patch("/routers/:id", async (req, res): Promise<void> => {
  const id = req.params.id;
  const { name, host, ipAddress, model, rosVersion, status, router_username, apiUsername, router_secret, apiPassword, bridge_ip } = req.body;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name           !== undefined) updates.name            = name;
  if (host           !== undefined) updates.host            = host;
  if (ipAddress      !== undefined) updates.host            = ipAddress;
  if (model          !== undefined) updates.model           = model;
  if (rosVersion     !== undefined) updates.ros_version     = rosVersion;
  if (status         !== undefined) updates.status          = status;
  if (router_username !== undefined) updates.router_username = router_username;
  if (apiUsername    !== undefined) updates.router_username = apiUsername;
  if (router_secret  !== undefined) updates.router_secret   = router_secret;
  if (apiPassword    !== undefined) updates.router_secret   = apiPassword;
  if (bridge_ip      !== undefined) updates.bridge_ip       = bridge_ip;
  const [r] = await sbUpdate<Record<string, unknown>>("isp_routers", `id=eq.${id}`, updates);
  if (!r) { res.status(404).json({ error: "Router not found" }); return; }
  const adminIdForLog = req.body?.adminId ?? req.query.adminId ?? 1;
  void logActivity({ adminId: Number(adminIdForLog), type: "router", action: "updated", subject: String(updates.name ?? id), details: updates });
  res.json(r);
});

router.delete("/routers/:id", async (req, res): Promise<void> => {
  const id = req.params.id;
  const rows = await sbSelect<{ name: string; admin_id: number }>("isp_routers", `id=eq.${id}&select=name,admin_id&limit=1`);
  const row = rows[0];
  await sbDelete("isp_routers", `id=eq.${id}`);
  if (row) void logActivity({ adminId: row.admin_id, type: "router", action: "deleted", subject: row.name });
  res.sendStatus(204);
});

/* ══ POST /api/routers/:id/ping ═════════════════════════════════════════════
 * Tries to connect to the router via RouterOS API.
 * Updates status + last_seen in Supabase and returns the result.
 * ══════════════════════════════════════════════════════════════════════════ */
router.post("/routers/:id/ping", async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id;

  const rows = await sbSelect<{
    id: number; host: string; bridge_ip: string | null;
    router_username: string; router_secret: string | null;
  }>("isp_routers", `id=eq.${id}&select=id,host,bridge_ip,router_username,router_secret&limit=1`);

  const row = rows[0];
  if (!row) { res.status(404).json({ ok: false, error: "Router not found" }); return; }

  const creds = {
    host:     row.host?.trim()      || "",
    port:     8728,
    username: row.router_username   || "admin",
    password: row.router_secret     || "",
    useSSL:   false,
    bridgeIp: row.bridge_ip?.trim() || undefined,
    connectTimeoutMs:  8000,
    requestTimeoutMs:  8000,
  };

  try {
    const result = await pingRouter(creds);

    await sbUpdate("isp_routers", `id=eq.${id}`, {
      status:     "online",
      last_seen:  result.connectedAt,
      model:      result.board || undefined,
      ros_version: result.version || undefined,
      updated_at: result.connectedAt,
    });

    logger.info({ routerId: id, identity: result.identity }, "[router/ping] online");
    res.json({ ok: true, ...result });
  } catch (err) {
    const error = (err as Error).message;
    await sbUpdate("isp_routers", `id=eq.${id}`, {
      status:     "offline",
      updated_at: new Date().toISOString(),
    });
    logger.warn({ routerId: id, error }, "[router/ping] offline");
    res.json({ ok: false, online: false, error });
  }
});

/* ══ POST /api/routers/ping-all ═════════════════════════════════════════════
 * Pings every router for an admin and returns a summary.
 * ══════════════════════════════════════════════════════════════════════════ */
router.post("/routers/ping-all", async (req: Request, res: Response): Promise<void> => {
  const adminId = req.body?.adminId ?? req.query.adminId ?? "1";

  const routers = await sbSelect<{
    id: number; name: string; host: string; bridge_ip: string | null;
    router_username: string; router_secret: string | null;
  }>("isp_routers", `admin_id=eq.${adminId}&select=id,name,host,bridge_ip,router_username,router_secret`);

  if (!routers.length) { res.json({ ok: true, results: [], total: 0 }); return; }

  const results = await Promise.allSettled(
    routers.map(async (row) => {
      const creds = {
        host:     row.host?.trim()      || "",
        port:     8728,
        username: row.router_username   || "admin",
        password: row.router_secret     || "",
        useSSL:   false,
        bridgeIp: row.bridge_ip?.trim() || undefined,
        connectTimeoutMs: 8000,
        requestTimeoutMs: 8000,
      };
      try {
        const r = await pingRouter(creds);
        await sbUpdate("isp_routers", `id=eq.${row.id}`, {
          status: "online", last_seen: r.connectedAt,
          model: r.board || undefined, ros_version: r.version || undefined,
          updated_at: r.connectedAt,
        });
        return { id: row.id, name: row.name, online: true, identity: r.identity, uptime: r.uptime };
      } catch (err) {
        /* Only write "offline" in production — in dev the VPS is the source of truth */
        if (process.env.NODE_ENV === "production") {
          await sbUpdate("isp_routers", `id=eq.${row.id}`, {
            status: "offline", updated_at: new Date().toISOString(),
          });
        }
        return { id: row.id, name: row.name, online: false, error: (err as Error).message };
      }
    })
  );

  const mapped = results.map(r => r.status === "fulfilled" ? r.value : { online: false, error: "unexpected" });
  const online  = mapped.filter(r => r.online).length;
  const offline = mapped.length - online;

  logger.info({ online, offline }, "[router/ping-all] sweep complete");
  res.json({ ok: true, results: mapped, total: mapped.length, online, offline });
});

/* ── Hysteresis: only write "offline" after OFFLINE_THRESHOLD consecutive failures ── */
const OFFLINE_THRESHOLD = 2;
const failureCount = new Map<number, number>();

/* ══ Exported helper for background monitor ════════════════════════════════ */
export async function sweepAllRouters(): Promise<void> {
  try {
    const routers = await sbSelect<{
      id: number; name: string; host: string; bridge_ip: string | null;
      router_username: string; router_secret: string | null;
    }>("isp_routers", "select=id,name,host,bridge_ip,router_username,router_secret");

    if (!routers.length) return;

    await Promise.allSettled(
      routers.map(async (row) => {
        const creds = {
          host:     row.host?.trim()      || "",
          port:     8728,
          username: row.router_username   || "admin",
          password: row.router_secret     || "",
          useSSL:   false,
          bridgeIp: row.bridge_ip?.trim() || undefined,
          connectTimeoutMs: 10_000,
          requestTimeoutMs: 10_000,
        };
        try {
          const r = await pingRouter(creds);
          /* Reset failure counter on success */
          failureCount.set(row.id, 0);
          await sbUpdate("isp_routers", `id=eq.${row.id}`, {
            status: "online", last_seen: r.connectedAt,
            model: r.board || undefined, ros_version: r.version || undefined,
            updated_at: r.connectedAt,
          });
          logger.info({ id: row.id, name: row.name, identity: r.identity }, "[monitor] router online");
        } catch (err) {
          const prev = failureCount.get(row.id) ?? 0;
          const next = prev + 1;
          failureCount.set(row.id, next);
          logger.warn({ id: row.id, name: row.name, failures: next, err: (err as Error).message }, "[monitor] router unreachable");

          /* Only write "offline" after OFFLINE_THRESHOLD consecutive failures.
             In dev mode skip entirely — dev server can't reach VPN IPs. */
          if (process.env.NODE_ENV === "production" && next >= OFFLINE_THRESHOLD) {
            await sbUpdate("isp_routers", `id=eq.${row.id}`, {
              status: "offline", updated_at: new Date().toISOString(),
            });
            logger.warn({ id: row.id, name: row.name }, "[monitor] router marked offline");
          }
        }
      })
    );
  } catch (err) {
    logger.error({ err }, "[monitor] sweep error");
  }
}

export default router;
