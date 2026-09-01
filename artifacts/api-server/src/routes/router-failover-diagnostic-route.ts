import { Router, type IRouter, type Request, type Response } from "express";
import { sbSelect } from "../lib/supabase-client.js";
import { logActivity } from "../lib/activity-log.js";
import { authenticatedAdminId, requireAdmin } from "../lib/api-auth.js";
import { isRouterVpnIp } from "../lib/router-vpn-ip.js";
import {
  readRouterFailoverSnapshot,
  routerFailoverCredentialsAreValid,
  routerFailoverEndpoints,
  runStagedRouterFailover,
  type RouterFailoverRun,
  type RouterFailoverSnapshot,
} from "../lib/router-failover-diagnostic.js";

const router: IRouter = Router();
let activeRun: Promise<RouterFailoverRun> | null = null;

interface DiagnosticRouter {
  id: number;
  admin_id: number;
  name: string;
  vpn_ip: string | null;
  status: string;
  last_seen: string | null;
  model: string | null;
  ros_version: string | null;
}

interface FailoverHistory {
  id: number;
  subject: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

function parseRouterId(value: unknown): number {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

function expectedPrimaryIp(routerId: number, value: string | null): string {
  return isRouterVpnIp(value) ? value!.trim() : `10.8.5.${2 + ((routerId - 1) % 253)}`;
}

function routerosEvidence(row: DiagnosticRouter): {
  available: boolean;
  source: "routeros_heartbeat" | "server_staged_only";
  lastSeen: string | null;
} {
  const available = Boolean(row.last_seen) || row.status === "online" || row.status === "connected";
  return {
    available,
    source: available ? "routeros_heartbeat" : "server_staged_only",
    lastSeen: row.last_seen,
  };
}

async function readDiagnosticRouter(routerId: number, adminId: number): Promise<DiagnosticRouter | null> {
  const rows = await sbSelect<DiagnosticRouter>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,admin_id,name,vpn_ip,status,last_seen,model,ros_version&limit=1`,
  );
  return rows[0] ?? null;
}

async function historyFor(adminId: number, routerName: string): Promise<FailoverHistory[]> {
  return sbSelect<FailoverHistory>(
    "isp_activity_logs",
    `admin_id=eq.${adminId}&type=eq.router&action=eq.router_failover_diagnostic&subject=eq.${encodeURIComponent(routerName)}&order=created_at.desc&limit=5&select=id,subject,details,created_at`,
  );
}

function safeRunDetails(run: RouterFailoverRun): Record<string, unknown> {
  return {
    source: run.source,
    ok: run.ok,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    primaryTunnelIp: run.primaryTunnelIp,
    backupTunnelIp: run.backupTunnelIp,
    steps: run.steps,
    error: run.error ?? null,
  };
}

async function diagnosticPayload(
  row: DiagnosticRouter,
  adminId: number,
  snapshot?: RouterFailoverSnapshot,
) {
  const primaryIp = expectedPrimaryIp(row.id, row.vpn_ip);
  const endpoints = routerFailoverEndpoints(row.id, primaryIp);
  const live = snapshot ?? await readRouterFailoverSnapshot(row.name);
  return {
    ok: true,
    router: {
      id: row.id,
      name: row.name,
      status: row.status,
      model: row.model,
      rosVersion: row.ros_version,
      lastSeen: row.last_seen,
    },
    endpoints,
    routerosEvidence: routerosEvidence(row),
    live: {
      checkedAt: live.checkedAt,
      ok: live.ok,
      error: live.error ?? null,
      primary: live.primary,
      backup: live.backup,
    },
    history: await historyFor(adminId, row.name),
  };
}

router.get("/admin/router/failover-diagnostic/:id", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  const routerId = parseRouterId(req.params.id);
  const adminId = authenticatedAdminId(req, req.query.adminId);
  if (!routerId || !adminId) {
    res.status(400).json({ ok: false, error: "A valid router id and signed-in ISP account are required." });
    return;
  }
  try {
    const row = await readDiagnosticRouter(routerId, adminId);
    if (!row) {
      res.status(404).json({ ok: false, error: "Router not found for this ISP account." });
      return;
    }
    if (!routerFailoverCredentialsAreValid(row.name)) {
      res.status(422).json({ ok: false, error: "This router name cannot be used as a safe management VPN identity." });
      return;
    }
    res.json(await diagnosticPayload(row, adminId));
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: `Router failover diagnostics could not be read: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

router.post("/admin/router/failover-diagnostic/:id/run", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  const routerId = parseRouterId(req.params.id);
  const adminId = authenticatedAdminId(req, req.body?.adminId);
  if (!routerId || !adminId) {
    res.status(400).json({ ok: false, error: "A valid router id and signed-in ISP account are required." });
    return;
  }
  if (activeRun) {
    res.status(409).json({ ok: false, error: "Another router failover diagnostic is already running. Wait for it to finish." });
    return;
  }
  try {
    const row = await readDiagnosticRouter(routerId, adminId);
    if (!row) {
      res.status(404).json({ ok: false, error: "Router not found for this ISP account." });
      return;
    }
    if (!routerFailoverCredentialsAreValid(row.name)) {
      res.status(422).json({ ok: false, error: "This router name cannot be used as a safe management VPN identity." });
      return;
    }
    const primaryIp = expectedPrimaryIp(row.id, row.vpn_ip);
    const runPromise = runStagedRouterFailover(row.id, row.name, primaryIp);
    activeRun = runPromise;
    const run = await runPromise;
    await logActivity({
      adminId,
      type: "router",
      action: "router_failover_diagnostic",
      subject: row.name,
      details: safeRunDetails(run),
    });
    const snapshot = await readRouterFailoverSnapshot(row.name);
    res.status(run.ok ? 200 : 503).json({
      ok: run.ok,
      run,
      diagnostic: await diagnosticPayload(row, adminId, snapshot),
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: `Router failover diagnostic failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    activeRun = null;
  }
});

export default router;