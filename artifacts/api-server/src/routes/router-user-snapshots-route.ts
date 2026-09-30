import { Router, type Request, type Response } from "express";
import { authenticatedTenantAdminId, requireAuth } from "../lib/api-auth.js";
import { sbRpc, sbSelectStrict } from "../lib/supabase-client.js";
import { logger } from "../lib/logger.js";
import { getRouterCreds } from "./mikrotik-route.js";
import {
  failRouterUserSnapshot,
  syncClaimedRouterUserSnapshot,
} from "../services/router-user-snapshot-service.js";

const router = Router();
const ROOT = "/router-user-snapshots";

interface OwnedRouter {
  id: number;
  admin_id: number;
  name: string | null;
}

interface SnapshotStatusRow {
  schedule_enabled: boolean;
  next_sync_at: string | null;
  last_attempt_at: string | null;
  last_synced_at: string | null;
  last_sync_status: "never" | "success" | "failed";
  last_error_code: string | null;
  ppp_count: number;
  hotspot_count: number;
}

function routerIdFrom(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") return 0;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

async function tenantIdForRequest(req: Request, res: Response): Promise<number> {
  if (req.authUser?.type !== "a") {
    res.status(403).json({ error: "An ISP admin account is required." });
    return 0;
  }
  const adminId = await authenticatedTenantAdminId(req);
  if (!Number.isSafeInteger(adminId) || adminId <= 0) {
    res.status(403).json({ error: "The signed-in ISP account could not be verified." });
    return 0;
  }
  return adminId;
}

async function loadOwnedRouter(adminId: number, id: number): Promise<OwnedRouter | null> {
  const rows = await sbSelectStrict<OwnedRouter>(
    "isp_routers",
    `id=eq.${id}&admin_id=eq.${adminId}&select=id,admin_id,name&limit=1`,
  );
  return rows[0] ?? null;
}

router.use(ROOT, requireAuth("a"));

router.get(`${ROOT}/:routerId`, async (req, res) => {
  const adminId = await tenantIdForRequest(req, res);
  if (!adminId) return;
  const routerId = routerIdFrom(req.params.routerId);
  if (!routerId) {
    res.status(400).json({ error: "A valid router id is required." });
    return;
  }

  try {
    const ownedRouter = await loadOwnedRouter(adminId, routerId);
    if (!ownedRouter) {
      res.status(404).json({ error: "Router not found for this ISP account." });
      return;
    }
    const rows = await sbSelectStrict<SnapshotStatusRow>(
      "router_user_snapshots",
      `admin_id=eq.${adminId}&router_id=eq.${routerId}&select=schedule_enabled,next_sync_at,last_attempt_at,last_synced_at,last_sync_status,last_error_code,ppp_count,hotspot_count&limit=1`,
    );
    const row = rows[0];
    res.setHeader("Cache-Control", "no-store");
    res.json({
      routerId,
      routerName: ownedRouter.name,
      snapshotAvailable: Boolean(row?.last_synced_at),
      scheduleEnabled: row?.schedule_enabled ?? false,
      nextSyncAt: row?.next_sync_at ?? null,
      lastAttemptAt: row?.last_attempt_at ?? null,
      lastSyncedAt: row?.last_synced_at ?? null,
      status: row?.last_sync_status ?? "never",
      errorCode: row?.last_error_code ?? null,
      pppCount: row?.ppp_count ?? 0,
      hotspotCount: row?.hotspot_count ?? 0,
    });
  } catch {
    logger.warn({ adminId, routerId }, "[user-snapshots] status could not be loaded");
    res.status(500).json({ error: "User backup status could not be loaded." });
  }
});

router.patch(`${ROOT}/:routerId/schedule`, async (req, res) => {
  const adminId = await tenantIdForRequest(req, res);
  if (!adminId) return;
  const routerId = routerIdFrom(req.params.routerId);
  if (!routerId) {
    res.status(400).json({ error: "A valid router id is required." });
    return;
  }
  if (typeof req.body?.enabled !== "boolean") {
    res.status(400).json({ error: "The enabled field must be true or false." });
    return;
  }

  try {
    const ownedRouter = await loadOwnedRouter(adminId, routerId);
    if (!ownedRouter) {
      res.status(404).json({ error: "Router not found for this ISP account." });
      return;
    }
    const rows = await sbRpc<{ schedule_enabled: boolean; next_sync_at: string | null }>(
      "set_router_user_snapshot_schedule",
      { p_admin_id: adminId, p_router_id: routerId, p_enabled: req.body.enabled },
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      scheduleEnabled: rows[0]?.schedule_enabled ?? req.body.enabled,
      nextSyncAt: rows[0]?.next_sync_at ?? null,
    });
  } catch {
    logger.warn({ adminId, routerId }, "[user-snapshots] schedule could not be updated");
    res.status(500).json({ error: "The daily refresh setting could not be saved." });
  }
});

router.post(`${ROOT}/:routerId/sync`, async (req, res) => {
  const adminId = await tenantIdForRequest(req, res);
  if (!adminId) return;
  const routerId = routerIdFrom(req.params.routerId);
  if (!routerId) {
    res.status(400).json({ error: "A valid router id is required." });
    return;
  }

  let leaseToken = "";
  try {
    const ownedRouter = await loadOwnedRouter(adminId, routerId);
    if (!ownedRouter) {
      res.status(404).json({ error: "Router not found for this ISP account." });
      return;
    }

    const claims = await sbRpc<{ lease_token: string }>("claim_router_user_snapshot", {
      p_admin_id: adminId,
      p_router_id: routerId,
      p_force: true,
    });
    leaseToken = claims[0]?.lease_token ?? "";
    if (!leaseToken) {
      res.status(409).json({ error: "A user backup is already running for this router. Try again shortly." });
      return;
    }

    const found = await getRouterCreds(routerId, adminId);
    if (!found) {
      await failRouterUserSnapshot(adminId, routerId, leaseToken, "router_unavailable");
      res.status(503).json({ error: "Router connection details are unavailable. Check the router and try again." });
      return;
    }

    const result = await syncClaimedRouterUserSnapshot(
      adminId,
      routerId,
      leaseToken,
      found.row.name ?? ownedRouter.name ?? `Router ${routerId}`,
      found.creds,
    );
    if (!result.ok) {
      res.status(result.errorCode === "snapshot_too_large" ? 413 : 502).json({
        error: result.errorCode === "snapshot_too_large"
          ? "The user backup is larger than the secure storage limit."
          : "The router could not be synced. Check its connection and try again.",
      });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      lastSyncedAt: result.capturedAt,
      pppCount: result.pppCount,
      hotspotCount: result.hotspotCount,
    });
  } catch {
    if (leaseToken) {
      await failRouterUserSnapshot(adminId, routerId, leaseToken, "sync_failed").catch(() => undefined);
    }
    logger.warn({ adminId, routerId }, "[user-snapshots] manual sync failed");
    res.status(500).json({ error: "The user backup could not be completed." });
  }
});

export default router;