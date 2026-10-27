import { Router, type IRouter } from "express";
import { authenticatedAccount, requireAdmin } from "../lib/api-auth.js";
import { logActivity } from "../lib/activity-log.js";
import {
  collectIdOrderedPages,
  sbInsertStrict,
  sbSelectStrict,
  sbUpdateStrict,
} from "../lib/supabase-client.js";
import {
  updateHotspotUserServers,
  type HotspotUserServerChange,
  type RouterCredentials,
} from "../lib/mikrotik.js";
import { portServiceResourceNames } from "../lib/port-service-resources.js";
import { readVpnClients, vpnIpFor } from "../lib/vpn-status.js";
import { ROUTER_MANAGEMENT_API_USERNAME } from "../lib/router-management-vpn.js";
import { hotspotRoamingEnabled } from "../lib/hotspot-roaming-settings.js";

const router: IRouter = Router();

type RouterRow = {
  id: number;
  name: string;
  status?: string | null;
  host?: string | null;
  bridge_ip?: string | null;
  vpn_ip?: string | null;
  router_username?: string | null;
  router_secret?: string | null;
};
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
type RoamingCustomerRow = { id: number; username: string | null; plan_id: number | null };
type RoamingPlanRow = {
  id: number;
  name: string;
  router_id: number | null;
  port_id: number | null;
  owner_reseller_id: number | null;
};

function roamingRouterCredentials(row: RouterRow): RouterCredentials {
  const validManagementIp = (value: unknown) =>
    /^10\.8\.[56]\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(String(value ?? "").trim());
  const storedManagementIp = [row.vpn_ip, row.bridge_ip].find(validManagementIp)?.trim() || "";
  const clients = readVpnClients();
  const managementIp = vpnIpFor(row.host ?? "", clients)
    ?? vpnIpFor(row.name ?? "", clients)
    ?? storedManagementIp;
  const host = row.host?.trim() || managementIp;
  if (!host) throw new Error(`Router '${row.name}' has no reachable management address.`);
  const username = managementIp
    ? (row.router_username?.trim() || ROUTER_MANAGEMENT_API_USERNAME)
    : (row.router_username?.trim() || "admin");
  return {
    host,
    port: 8728,
    username,
    password: row.router_secret || "",
    alternateUsernames: managementIp && username !== ROUTER_MANAGEMENT_API_USERNAME
      ? [ROUTER_MANAGEMENT_API_USERNAME]
      : undefined,
    bridgeIp: managementIp && managementIp !== host ? managementIp : undefined,
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 12_000,
  };
}

async function syncTenantHotspotUserServers(adminId: number, enabled: boolean): Promise<number> {
  const customers = await collectIdOrderedPages((afterId, pageSize) =>
    sbSelectStrict<RoamingCustomerRow>(
      "isp_customers",
      `admin_id=eq.${adminId}&type=eq.hotspot&status=eq.active&id=gt.${afterId}&select=id,username,plan_id&order=id.asc&limit=${pageSize}`,
    ),
  );
  const planIds = Array.from(new Set(customers.map(row => Number(row.plan_id)).filter(id =>
    Number.isSafeInteger(id) && id > 0,
  )));
  const plans: RoamingPlanRow[] = [];
  for (let offset = 0; offset < planIds.length; offset += 100) {
    const ids = planIds.slice(offset, offset + 100);
    plans.push(...await sbSelectStrict<RoamingPlanRow>(
      "isp_plans",
      `admin_id=eq.${adminId}&id=in.(${ids.join(",")})&type=in.(hotspot,trial,trials)&select=id,name,router_id,port_id,owner_reseller_id&limit=100`,
    ));
  }
  const planById = new Map(plans.filter(plan => plan.owner_reseller_id == null).map(plan => [plan.id, plan]));
  const accounts = customers.flatMap(customer => {
    const plan = planById.get(Number(customer.plan_id));
    return customer.username?.trim() && plan?.router_id
      ? [{ customer, plan, routerId: Number(plan.router_id) }]
      : [];
  });
  const portIds = Array.from(new Set(accounts.map(({ plan }) => Number(plan.port_id)).filter(id =>
    Number.isSafeInteger(id) && id > 0,
  )));
  const ports: PortRow[] = [];
  for (let offset = 0; offset < portIds.length; offset += 100) {
    const ids = portIds.slice(offset, offset + 100);
    ports.push(...await sbSelectStrict<PortRow & {
      bridge_name?: string | null;
      handoff_mode?: "services" | "isp_router" | "vlan_services" | null;
      reseller_id?: number | null;
      vlan_tag?: string | null;
    }>(
      "isp_reseller_ports",
      `admin_id=eq.${adminId}&id=in.(${ids.join(",")})&select=id,router_id,interface_name,status,hotspot_enabled,assigned_reseller_id,bridge_name,handoff_mode,reseller_id,vlan_tag&limit=100`,
    ));
  }
  const portById = new Map(ports.map(port => [port.id, port]));
  const ispAccounts = accounts.filter(({ plan }) =>
    !plan.port_id || portById.get(plan.port_id)?.assigned_reseller_id == null,
  );
  const routerIds = Array.from(new Set(ispAccounts.map(account => account.routerId)));
  if (enabled && routerIds.length) {
    const resellerPorts = await sbSelectStrict<{ id: number; router_id: number }>(
      "isp_reseller_ports",
      `admin_id=eq.${adminId}&router_id=in.(${routerIds.join(",")})&status=eq.active&hotspot_enabled=is.true&assigned_reseller_id=not.is.null&select=id,router_id&limit=1000`,
    );
    if (resellerPorts.length) {
      throw new Error("Global roaming cannot safely use RouterOS server=all on a MikroTik that also hosts reseller-owned Hotspots.");
    }
  }
  const routers = routerIds.length
    ? await sbSelectStrict<RouterRow>(
        "isp_routers",
        `admin_id=eq.${adminId}&id=in.(${routerIds.join(",")})&select=id,name,host,bridge_ip,vpn_ip,router_username,router_secret&limit=100`,
      )
    : [];
  const routerById = new Map(routers.map(router => [router.id, router]));
  const companyRows = await sbSelectStrict<{ name: string | null }>(
    "isp_admins",
    `id=eq.${adminId}&select=name&limit=1`,
  );
  const companyName = companyRows[0]?.name ?? null;
  const sameRouterExceptions = await sbSelectStrict<RuleRow>(
    "isp_hotspot_roaming_rules",
    `admin_id=eq.${adminId}&enabled=is.true&select=id,admin_id,source_router_id,source_port_id,target_router_id,target_port_id,enabled,created_at&limit=1000`,
  );
  if (sameRouterExceptions.length >= 1000) {
    throw new Error("Too many explicit roaming rules to safely update account server bindings.");
  }

  const grouped = new Map<number, HotspotUserServerChange[]>();
  const desiredByKey = new Map<string, { expected: string[]; desired: string }>();
  for (const { customer, plan, routerId } of ispAccounts) {
    const router = routerById.get(routerId);
    if (!router) throw new Error(`MikroTik ${routerId} could not be found for an active Hotspot account.`);
    const port = plan.port_id ? portById.get(plan.port_id) : null;
    if (plan.port_id && !port) {
      throw new Error(`The Hotspot service for plan ${plan.id} could not be found.`);
    }
    const sourceServer = port
      ? portServiceResourceNames(port, { companyName, routerName: router.name }).hotspotServer
      : "all";
    const hasSameRouterException = sameRouterExceptions.some(rule =>
      rule.source_router_id === routerId
      && (rule.source_port_id === null || rule.source_port_id === plan.port_id)
      && rule.target_router_id === routerId
      && rule.target_port_id !== plan.port_id,
    );
    const desired = enabled || hasSameRouterException ? "all" : sourceServer;
    const expected = Array.from(new Set([sourceServer, "all"]));
    const key = `${routerId}:${customer.username}`;
    const previous = desiredByKey.get(key);
    if (previous && previous.desired !== desired) {
      throw new Error(`The Hotspot account '${customer.username}' is linked to conflicting service packages.`);
    }
    desiredByKey.set(key, { expected, desired });
  }
  for (const [key, binding] of desiredByKey) {
    const separator = key.indexOf(":");
    const routerId = Number(key.slice(0, separator));
    const name = key.slice(separator + 1);
    const group = grouped.get(routerId) ?? [];
    group.push({ name, expectedServer: binding.expected, server: binding.desired });
    grouped.set(routerId, group);
  }

  const changedByRouter: Array<{ routerId: number; changes: Array<{ name: string; previousServer: string; server: string }> }> = [];
  try {
    for (const [routerId, changes] of grouped) {
      const router = routerById.get(routerId);
      if (!router) throw new Error(`MikroTik ${routerId} is unavailable.`);
      const updated = await updateHotspotUserServers(roamingRouterCredentials(router), changes);
      changedByRouter.push({ routerId, changes: updated });
    }
  } catch (error) {
    for (const { routerId, changes } of changedByRouter.reverse()) {
      const router = routerById.get(routerId);
      if (!router) continue;
      await updateHotspotUserServers(roamingRouterCredentials(router), changes.map(change => ({
        name: change.name,
        expectedServer: change.server,
        server: change.previousServer,
      }))).catch(() => {});
    }
    throw error;
  }
  return ispAccounts.length;
}

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
    const [routers, ports, rules, roamingEnabled, resellerPorts] = await Promise.all([
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
      hotspotRoamingEnabled(adminId),
      sbSelectStrict<{ router_id: number }>(
        "isp_reseller_ports",
        `admin_id=eq.${adminId}&status=eq.active&hotspot_enabled=is.true&assigned_reseller_id=not.is.null&select=router_id&limit=1000`,
      ),
    ]);
    const routerNames = new Map(routers.map(row => [row.id, row.name]));
    const portNames = new Map(ports.map(row => [row.id, row.interface_name]));
    res.json({
      ok: true,
      roamingEnabled,
      roamingBlockedRouters: Array.from(new Set(resellerPorts.map(port => port.router_id)))
        .map(id => routerNames.get(id) ?? `MikroTik ${id}`),
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

router.put("/admin/hotspot-roaming/settings", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = await tenantAdminId(req);
  if (!adminId) {
    res.status(403).json({ ok: false, error: "An ISP administrator session is required." });
    return;
  }
  if (typeof req.body?.enabled !== "boolean") {
    res.status(400).json({ ok: false, error: "Choose whether Hotspot roaming should be enabled." });
    return;
  }
  try {
    const existing = await sbSelectStrict<{ admin_id: number; enabled: boolean }>(
      "isp_hotspot_roaming_settings",
      `admin_id=eq.${adminId}&select=admin_id,enabled&limit=1`,
    );
    const updatedAccounts = await syncTenantHotspotUserServers(adminId, req.body.enabled);
    const settings = { enabled: req.body.enabled, updated_at: new Date().toISOString() };
    const saved = existing.length
      ? await sbUpdateStrict<{ admin_id: number; enabled: boolean }>(
          "isp_hotspot_roaming_settings",
          `admin_id=eq.${adminId}`,
          settings,
        )
      : await sbInsertStrict<{ admin_id: number; enabled: boolean }>(
          "isp_hotspot_roaming_settings",
          [{ admin_id: adminId, ...settings }],
        );
    if (!saved[0]) throw new Error("The roaming setting was not saved.");
    void logActivity({
      adminId,
      type: "plan",
      action: req.body.enabled ? "hotspot_roaming_enabled" : "hotspot_roaming_disabled",
      subject: "All ISP-owned Hotspot services",
      details: { updatedAccounts },
    });
    res.json({ ok: true, roamingEnabled: saved[0].enabled, updatedAccounts });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error instanceof Error && error.message.startsWith("Global roaming cannot safely")
        ? error.message
        : "The roaming setting could not be saved because not all active Hotspot accounts could be synchronized. Retry after checking the affected MikroTik connections.",
    });
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
