import { Router, type IRouter } from "express";
import { authenticatedAccount, authenticatedAdminId, authenticatedTenantAdminId, requireAdmin } from "../lib/api-auth.js";
import { sbSelectStrict } from "../lib/supabase-client.js";
import { fetchHotspotUsers, fetchPPPoEActive } from "../lib/mikrotik.js";
import { getRouterCreds } from "./mikrotik-route.js";

const router: IRouter = Router();

type CopilotCustomer = {
  id: number;
  admin_id: number;
  name: string | null;
  username: string | null;
  pppoe_username: string | null;
  phone: string | null;
  type: string | null;
  status: string | null;
  expires_at: string | null;
  plan_id: number | null;
  router_id: number | null;
  port_id: number | null;
  mac_address: string | null;
};

router.post("/admin/copilot/diagnose", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = authenticatedAdminId(req);
  const search = typeof req.body?.query === "string" ? req.body.query.trim().slice(0, 100) : "";
  if (!adminId || search.length < 2 || !/^[\p{L}\p{N}@.+_\- ]+$/u.test(search)) {
    res.status(400).json({ error: "Enter at least two characters from the customer name, username, or phone." });
    return;
  }
  try {
    const term = encodeURIComponent(search);
    const customers = await sbSelectStrict<CopilotCustomer>(
      "isp_customers",
      `admin_id=eq.${adminId}&or=(name.ilike.*${term}*,username.ilike.*${term}*,pppoe_username.ilike.*${term}*,phone.ilike.*${term}*)&select=id,admin_id,name,username,pppoe_username,phone,type,status,expires_at,plan_id,router_id,port_id,mac_address&order=updated_at.desc&limit=10`,
    );
    if (!customers.length) {
      res.json({ checkedAt: new Date().toISOString(), matches: [], message: "No customer matched within your account." });
      return;
    }
    const tenantId = await authenticatedTenantAdminId(req);
    const account = await authenticatedAccount(req);
    if (!account) { res.status(401).json({ error: "A valid administrator session is required." }); return; }
    const results = await Promise.all(customers.map(async customer => {
      const [transactions, plans, routerRows] = await Promise.all([
        sbSelectStrict<Record<string, unknown>>(
          "isp_transactions",
          `admin_id=eq.${adminId}&customer_id=eq.${customer.id}&select=id,status,payment_method,amount,created_at,notes,reference&order=created_at.desc&limit=5`,
        ),
        customer.plan_id
          ? sbSelectStrict<Record<string, unknown>>("isp_plans", `id=eq.${customer.plan_id}&admin_id=eq.${adminId}&select=id,name,type,price&limit=1`)
          : Promise.resolve([]),
        customer.router_id
          ? sbSelectStrict<{ id: number; name: string; status: string; last_seen: string | null }>(
              "isp_routers",
              `id=eq.${customer.router_id}&admin_id=eq.${tenantId}&select=id,name,status,last_seen&limit=1`,
            )
          : Promise.resolve([]),
      ]);
      const routerRow = routerRows[0];
      const service = String(customer.type ?? "").toLowerCase() === "pppoe" ? "pppoe" : "hotspot";
      let live: { state: "active" | "not-active" | "unavailable"; checkedAt: string; error?: string } = {
        state: "unavailable", checkedAt: new Date().toISOString(), error: "No assigned router is available for a live check.",
      };
      let assignedServiceAllowed = account.role !== "reseller";
      if (account.role === "reseller" && routerRow && customer.port_id) {
        const assignedPorts = await sbSelectStrict<{ id: number }>(
          "isp_reseller_ports",
          `id=eq.${customer.port_id}&assigned_reseller_id=eq.${adminId}&router_id=eq.${customer.router_id}&status=eq.active&select=id&limit=1`,
        );
        assignedServiceAllowed = assignedPorts.length > 0;
      }
      if (routerRow && tenantId && assignedServiceAllowed) {
        try {
          const connection = await getRouterCreds(Number(routerRow.id), tenantId);
          if (!connection) throw new Error("The assigned router is not accessible to this account.");
          const rows: unknown = service === "pppoe"
            ? await fetchPPPoEActive(connection.creds)
            : await fetchHotspotUsers(connection.creds);
          const identity = (service === "pppoe" ? customer.pppoe_username : customer.username) || customer.username || "";
          const found = Array.isArray(rows) && rows.some(value => {
            if (!value || typeof value !== "object") return false;
            const row = value as Record<string, unknown>;
            return [row.name, row.user, row.username].some(item => String(item ?? "").toLowerCase() === identity.toLowerCase());
          });
          live = { state: found ? "active" : "not-active", checkedAt: new Date().toISOString() };
        } catch (error) {
          live = {
            state: "unavailable",
            checkedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message.slice(0, 180) : "Router session check failed.",
          };
        }
      }
      const expired = customer.expires_at ? Date.parse(customer.expires_at) <= Date.now() : false;
      const paid = transactions.some(row => ["paid", "completed", "success"].includes(String(row.status ?? "").toLowerCase()));
      const activationPending = transactions.some(row =>
        /activation.*pending|routeros.*pending|account.*could not be activated/i.test(String(row.notes ?? "")),
      );
      const recommendations = [
        ...(activationPending ? ["Review Paid Hotspot Recovery and retry only after confirming the payment remains settled."] : []),
        ...(!paid ? ["Review recent transactions before restoring access; no successful payment was found in the checked records."] : []),
        ...(live.state === "not-active" && paid && !expired ? [`Use the existing ${service === "pppoe" ? "PPPoE" : "Hotspot"} recovery flow, then run this diagnosis again to verify the live session.`] : []),
        ...(expired ? ["Review the customer’s renewal or expiry in BIL before changing router access."] : []),
      ];
      return {
        customer: {
          id: customer.id, name: customer.name, username: customer.username, pppoeUsername: customer.pppoe_username,
          phone: customer.phone, service, status: customer.status, expiresAt: customer.expires_at,
        },
        payment: { recent: transactions, hasSuccessfulPayment: paid },
        plan: plans[0] ?? null,
        router: routerRow ? { id: routerRow.id, name: routerRow.name, status: routerRow.status, lastSeen: routerRow.last_seen } : null,
        liveSession: live,
        findings: [
          ...(expired ? ["The recorded service expiry has passed."] : []),
          ...(customer.status && !["active", "online"].includes(customer.status.toLowerCase()) ? [`Account status is ${customer.status}.`] : []),
          ...(!customer.router_id ? ["No router is assigned to this account."] : []),
          ...(customer.plan_id && !plans[0] ? ["The linked plan is unavailable in this account scope."] : []),
          ...(live.state === "not-active" ? ["The assigned router returned no matching active session."] : []),
          ...(live.state === "unavailable" ? [`Live session status is unverified: ${live.error}`] : []),
          ...(activationPending ? ["A recent payment note indicates RouterOS/account activation may still be pending; verify the payment and retry through the existing recovery page."] : []),
          ...transactions
            .filter(row => ["pending", "failed", "cancelled"].includes(String(row.status ?? "").toLowerCase()) || Boolean(row.notes))
            .slice(0, 2)
            .map(row => `Recent payment record: ${String(row.status ?? "unknown")}${row.notes ? ` — ${String(row.notes).slice(0, 180)}` : ""}.`),
          ...(!paid ? ["No successful payment was found in the five most recent transactions."] : []),
        ],
        recommendations,
      };
    }));
    res.json({ checkedAt: new Date().toISOString(), matches: results });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "The customer diagnosis could not be completed." });
  }
});

router.get("/admin/copilot/health", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = authenticatedAdminId(req);
  if (!adminId) { res.status(403).json({ error: "Administrator scope could not be resolved." }); return; }
  try {
    await sbSelectStrict<{ id: number }>("isp_admins", `id=eq.${adminId}&select=id&limit=1`);
    res.json({ checkedAt: new Date().toISOString(), api: "available", database: "available", source: "authorized live health check" });
  } catch {
    res.status(503).json({ checkedAt: new Date().toISOString(), api: "available", database: "unavailable", error: "The tenant database health check failed." });
  }
});

router.post("/admin/copilot/router-check", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = authenticatedAdminId(req);
  const tenantId = await authenticatedTenantAdminId(req);
  const routerId = Number(req.body?.routerId);
  if (!adminId || !tenantId || !Number.isSafeInteger(routerId) || routerId <= 0) {
    res.status(400).json({ error: "Choose a valid router from your account." });
    return;
  }
  try {
    const account = await authenticatedAccount(req);
    if (!account) { res.status(401).json({ error: "A valid administrator session is required." }); return; }
    if (account.role === "reseller") {
      const assignment = await sbSelectStrict<{ id: number }>(
        "isp_reseller_ports",
        `assigned_reseller_id=eq.${adminId}&router_id=eq.${routerId}&status=eq.active&select=id&limit=1`,
      );
      if (!assignment.length) { res.status(404).json({ error: "This router is not assigned to your reseller account." }); return; }
    }
    const rows = await sbSelectStrict<{ id: number; admin_id: number; name: string; status: string; last_seen: string | null }>(
      "isp_routers",
      `id=eq.${routerId}&admin_id=eq.${tenantId}&select=id,admin_id,name,status,last_seen&limit=1`,
    );
    const selected = rows[0];
    if (!selected) { res.status(404).json({ error: "Router not found in your account." }); return; }
    const connection = await getRouterCreds(routerId, tenantId);
    if (!connection) { res.status(503).json({ error: "Router credentials or management address are unavailable." }); return; }
    const [hotspot, pppoe] = await Promise.all([
      fetchHotspotUsers(connection.creds),
      fetchPPPoEActive(connection.creds),
    ]);
    res.json({
      checkedAt: new Date().toISOString(),
      router: { id: selected.id, name: selected.name, storedStatus: selected.status, lastSeen: selected.last_seen },
      live: { reachable: true, hotspotUsers: hotspot.length, pppoeSessions: pppoe.length },
      source: "live RouterOS API",
    });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message.slice(0, 180) : "Live router check failed." });
  }
});

router.post("/admin/copilot/script", requireAdmin(), (req, res): void => {
  const kind = req.body?.kind;
  if (kind !== "diagnostics" && kind !== "hotspot-check") {
    res.status(400).json({ error: "Choose one of the approved read-only script templates." });
    return;
  }
  const script = kind === "diagnostics"
    ? `# OCHOLASUPERNET Co-Pilot — read-only RouterOS diagnostics\n# Review the output before sharing. No configuration is changed.\n/system/identity/print\n/system/resource/print\n/system/package/print\n/interface/print terse\n/ip/address/print terse\n/ip/route/print terse\n/ip/hotspot/active/print terse\n/ppp/active/print terse\n/log/print where topics~\"error\"`
    : `# OCHOLASUPERNET Co-Pilot — read-only Hotspot checks\n# This script only reads status; it does not repair or change configuration.\n/ip/hotspot/print detail\n/ip/hotspot/profile/print detail\n/ip/hotspot/user/profile/print detail\n/ip/hotspot/active/print detail\n/ip/hotspot/host/print detail\n/ip/dns/print\n/ip/firewall/filter/print stats where chain=\"forward\"\n/log/print where topics~\"hotspot\"`;
  res.json({ kind, script, readOnly: true, generatedAt: new Date().toISOString() });
});

export default router;
