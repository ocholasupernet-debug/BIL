import { Router, type IRouter } from "express";
import { authenticatedAccount, requireAdmin } from "../lib/api-auth.js";
import { logActivity } from "../lib/activity-log.js";
import {
  sbInsertStrict,
  sbSelectStrict,
  sbUpdateStrict,
} from "../lib/supabase-client.js";

const router: IRouter = Router();

type RouterRow = { id: number; name: string; status?: string | null };
type PortRow = {
  id: number;
  router_id: number;
  interface_name: string;
  status: string | null;
  hotspot_enabled: boolean | null;
  assigned_reseller_id: number | null;
};
type RuleRow = {
  id: number;
  admin_id: number;
  source_router_id: number;
  source_port_id: number | null;
  target_router_id: number;
  target_port_id: number | null;
  enabled: boolean;
  created_at: string;
};

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function optionalId(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "" || value === "all") return null;
  return positiveId(value) ?? undefined;
}

async function tenantAdminId(req: Parameters<typeof authenticatedAccount>[0]): Promise<number | null> {
  const account = await authenticatedAccount(req);
  if (!account || account.role === "reseller") return null;
  const id = Number(account.parent_id ?? account.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function findOwnedRouter(adminId: number, routerId: number): Promise<RouterRow | null> {
  const rows = await sbSelectStrict<RouterRow>(
    "isp_routers",
    `id=eq.${routerId}&admin_id=eq.${adminId}&select=id,name,status&limit=1`,
  );
  return rows[0] ?? null;
}

async function findOwnedHotspotPort(
  adminId: number,
  routerId: number,
  portId: number,
): Promise<PortRow | null> {
  const rows = await sbSelectStrict<PortRow>(
    "isp_reseller_ports",
    `id=eq.${portId}&admin_id=eq.${adminId}&router_id=eq.${routerId}&status=eq.active&hotspot_enabled=is.true&assigned_reseller_id=is.null&select=id,router_id,interface_name,status,hotspot_enabled,assigned_reseller_id&limit=1`,
  );
  return rows[0] ?? null;
}

router.get("/admin/hotspot-roaming/context", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = await tenantAdminId(req);
  if (!adminId) {
    res.status(403).json({ ok: false, error: "An ISP administrator session is required." });
    return;
  }
  try {
    const [routers, ports, rules] = await Promise.all([
      sbSelectStrict<RouterRow>(
        "isp_routers",
        `admin_id=eq.${adminId}&status=not.in.(setup,awaiting_ports,awaiting_sync,awaiting_connection)&select=id,name,status&order=name.asc`,
      ),
      sbSelectStrict<PortRow>(
        "isp_reseller_ports",
        `admin_id=eq.${adminId}&status=eq.active&hotspot_enabled=is.true&assigned_reseller_id=is.null&select=id,router_id,interface_name,status,hotspot_enabled,assigned_reseller_id&order=interface_name.asc`,
      ),
      sbSelectStrict<RuleRow>(
        "isp_hotspot_roaming_rules",
        `admin_id=eq.${adminId}&enabled=is.true&select=id,admin_id,source_router_id,source_port_id,target_router_id,target_port_id,enabled,created_at&order=created_at.desc&limit=500`,
      ),
    ]);
    const routerNames = new Map(routers.map(row => [row.id, row.name]));
    const portNames = new Map(ports.map(row => [row.id, row.interface_name]));
    res.json({
      ok: true,
      routers,
      ports,
      rules: rules.map(rule => ({
        ...rule,
        source_router_name: routerNames.get(rule.source_router_id) ?? `MikroTik ${rule.source_router_id}`,
        source_port_name: rule.source_port_id ? portNames.get(rule.source_port_id) ?? `Port ${rule.source_port_id}` : null,
        target_router_name: routerNames.get(rule.target_router_id) ?? `MikroTik ${rule.target_router_id}`,
        target_port_name: rule.target_port_id ? portNames.get(rule.target_port_id) ?? `Port ${rule.target_port_id}` : null,
      })),
    });
  } catch {
    res.status(503).json({ ok: false, error: "Roaming permissions could not be loaded. Please try again." });
  }
});

router.post("/admin/hotspot-roaming/rules", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = await tenantAdminId(req);
  if (!adminId) {
    res.status(403).json({ ok: false, error: "An ISP administrator session is required." });
    return;
  }
  const sourceRouterId = positiveId(req.body?.sourceRouterId);
  const sourcePortId = optionalId(req.body?.sourcePortId);
  const targetRouterId = positiveId(req.body?.targetRouterId);
  const targetPortId = optionalId(req.body?.targetPortId);
  if (!sourceRouterId || sourcePortId === undefined || !targetRouterId || targetPortId === undefined) {
    res.status(400).json({ ok: false, error: "Choose valid source and destination MikroTik services." });
    return;
  }
  if (
    sourceRouterId === targetRouterId
    && sourcePortId === targetPortId
  ) {
    res.status(400).json({ ok: false, error: "Choose a different destination service." });
    return;
  }

  try {
    const [sourceRouter, targetRouter] = await Promise.all([
      findOwnedRouter(adminId, sourceRouterId),
      findOwnedRouter(adminId, targetRouterId),
    ]);
    if (!sourceRouter || !targetRouter) {
      res.status(400).json({ ok: false, error: "Both MikroTik routers must belong to this ISP account." });
      return;
    }
    const [sourcePort, targetPort] = await Promise.all([
      sourcePortId === null ? Promise.resolve(true) : findOwnedHotspotPort(adminId, sourceRouterId, sourcePortId),
      targetPortId === null ? Promise.resolve(true) : findOwnedHotspotPort(adminId, targetRouterId, targetPortId),
    ]);
    if (!sourcePort || !targetPort) {
      res.status(400).json({ ok: false, error: "Selected ports must be active Hotspot services owned by this ISP." });
      return;
    }

    const sourcePortFilter = sourcePortId === null ? "source_port_id=is.null" : `source_port_id=eq.${sourcePortId}`;
    const targetPortFilter = targetPortId === null ? "target_port_id=is.null" : `target_port_id=eq.${targetPortId}`;
    const existing = await sbSelectStrict<{ id: number; enabled: boolean }>(
      "isp_hotspot_roaming_rules",
      `admin_id=eq.${adminId}&source_router_id=eq.${sourceRouterId}&${sourcePortFilter}&target_router_id=eq.${targetRouterId}&${targetPortFilter}&select=id,enabled&limit=1`,
    );
    if (existing[0]?.enabled) {
      res.status(409).json({ ok: false, error: "That roaming permission already exists." });
      return;
    }
    const inserted = existing[0]
      ? await sbUpdateStrict<RuleRow>("isp_hotspot_roaming_rules", `id=eq.${existing[0].id}&admin_id=eq.${adminId}`, {
          enabled: true,
          updated_at: new Date().toISOString(),
        })
      : await sbInsertStrict<RuleRow>("isp_hotspot_roaming_rules", [{
          admin_id: adminId,
          source_router_id: sourceRouterId,
          source_port_id: sourcePortId,
          target_router_id: targetRouterId,
          target_port_id: targetPortId,
          enabled: true,
        }]);
    if (!inserted[0]) throw new Error("The roaming permission was not saved.");
    void logActivity({
      adminId,
      type: "plan",
      action: "roaming_permission_added",
      subject: `${sourceRouter.name} → ${targetRouter.name}`,
      details: { sourceRouterId, sourcePortId, targetRouterId, targetPortId },
    });
    res.status(201).json({ ok: true, rule: inserted[0] });
  } catch {
    res.status(503).json({ ok: false, error: "The roaming permission could not be saved. Please try again." });
  }
});

router.delete("/admin/hotspot-roaming/rules/:id", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = await tenantAdminId(req);
  const ruleId = positiveId(req.params.id);
  if (!adminId) {
    res.status(403).json({ ok: false, error: "An ISP administrator session is required." });
    return;
  }
  if (!ruleId) {
    res.status(400).json({ ok: false, error: "Choose a valid roaming permission." });
    return;
  }
  try {
    const deleted = await sbUpdateStrict<RuleRow>(
      "isp_hotspot_roaming_rules",
      `id=eq.${ruleId}&admin_id=eq.${adminId}&enabled=is.true`,
      { enabled: false, updated_at: new Date().toISOString() },
    );
    if (!deleted.length) {
      res.status(404).json({ ok: false, error: "That roaming permission no longer exists." });
      return;
    }
    void logActivity({
      adminId,
      type: "plan",
      action: "roaming_permission_removed",
      subject: `Permission ${ruleId}`,
    });
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: "The roaming permission could not be removed. Please try again." });
  }
});

export default router;
