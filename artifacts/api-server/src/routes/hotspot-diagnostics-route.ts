import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { authenticatedAdminId, requireAdmin } from "../lib/api-auth.js";
import { logActivity } from "../lib/activity-log.js";
import { runRouterCommand, runRouterCommands, fetchRouterFiles } from "../lib/mikrotik.js";
import { sbInsertStrict, sbSelect, sbUpdateStrict } from "../lib/supabase-client.js";
import { getRouterCreds } from "./mikrotik-route.js";

const router: IRouter = Router();
type RepairAction = "enable-server" | "select-profile" | "bind-server" | "enable-dhcp" | "enable-dns";
const ALLOWED_REPAIRS = new Set<RepairAction>([
  "enable-server", "select-profile", "bind-server", "enable-dhcp", "enable-dns",
]);
const repairPreviewTokens = new Map<string, { adminId: number; routerId: number; action: RepairAction; target: string; value: string; expiresAt: number }>();
type RepairPreview = { adminId: number; routerId: number; action: RepairAction; target: string; value: string; expiresAt: number };
export function consumeRepairPreview(
  previews: Map<string, RepairPreview>,
  token: string,
  expected: Omit<RepairPreview, "expiresAt">,
  now = Date.now(),
): boolean {
  const preview = previews.get(token);
  if (!preview) return false;
  previews.delete(token);
  return preview.adminId === expected.adminId
    && preview.routerId === expected.routerId
    && preview.action === expected.action
    && preview.target === expected.target
    && preview.value === expected.value
    && preview.expiresAt >= now;
}
const str = (value: unknown) => String(value ?? "").trim();
const rows = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value) ? value as Array<Record<string, unknown>> : [];

async function hasWanInputProtection(creds: Parameters<typeof runRouterCommand>[0]): Promise<boolean> {
  const rules = rows(await runRouterCommand(creds, [
    "/ip/firewall/filter/print",
    "=.proplist=chain,action,disabled,in-interface-list",
  ]));
  return rules.some(rule =>
    rule.chain === "input" &&
    ["drop", "reject"].includes(str(rule.action).toLowerCase()) &&
    rule.disabled !== "true" &&
    str(rule["in-interface-list"]).toLowerCase() === "wan",
  );
}

function check(id: string, label: string, status: "pass" | "warning" | "fail" | "unknown", detail: string) {
  return { id, label, status, detail };
}

router.get("/router/:id/hotspot-fix/diagnostics", requireAdmin(), async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store, private");
  const routerId = Number(req.params.id);
  const adminId = authenticatedAdminId(req, req.query.adminId);
  if (!Number.isSafeInteger(routerId) || routerId < 1) { res.status(400).json({ error: "Invalid router id." }); return; }
  if (!adminId) { res.status(403).json({ error: "The signed-in ISP account could not be verified." }); return; }
  const found = await getRouterCreds(routerId, adminId);
  if (!found) { res.status(404).json({ error: "Router not found or not assigned to this tenant." }); return; }

  try {
    const commands = [
      ["/system/resource/print", "=.proplist=version,uptime,board"],
      ["/ip/hotspot/print", "=.proplist=.id,name,interface,profile,disabled"],
      ["/ip/hotspot/profile/print", "=.proplist=.id,name,html-directory,hotspot-address,address-pool,dns-name"],
      ["/interface/bridge/print", "=.proplist=name,disabled,running"],
      ["/ip/address/print", "=.proplist=address,interface,disabled"],
      ["/ip/dhcp-server/print", "=.proplist=.id,name,interface,address-pool,disabled"],
      ["/ip/dhcp-server/network/print", "=.proplist=address,gateway,dns-server"],
      ["/ip/pool/print", "=.proplist=name,ranges"],
      ["/ip/dns/print", "=.proplist=servers,allow-remote-requests"],
      ["/ip/firewall/nat/print", "=.proplist=.id,chain,action,comment,disabled,src-address,out-interface"],
      ["/ip/firewall/filter/print", "=.proplist=.id,chain,action,comment,disabled,in-interface,in-interface-list,out-interface"],
      ["/ip/hotspot/user/profile/print", "=.proplist=name,rate-limit,shared-users"],
      ["/ip/hotspot/user/print", "=.proplist=name,profile,disabled"],
    ];
    const result = await runRouterCommands(found.creds, commands);
    const [resourceRows, servers, profiles, bridges, addresses, dhcpServers, dhcpNetworks, pools, dnsRows, nat, filter, userProfiles, users] = result.map(rows);
    const filesResult = await fetchRouterFiles(found.creds);
    const allFiles = (filesResult.files ?? []).map(file => str(file.name).replaceAll("\\", "/").toLowerCase());
    const primaryServer = servers.find(item => item.disabled !== "true") ?? servers[0];
    const primaryProfile = profiles.find(item => item.name === primaryServer?.profile);
    const directory = str(primaryProfile?.["html-directory"] || "hotspot").replace(/^\/+|\/+$/g, "");
    const relevantFiles = allFiles.filter(file =>
      file === `${directory.toLowerCase()}/login.html` ||
      file === `${directory.toLowerCase()}/rlogin.html` ||
      file.startsWith(`${directory.toLowerCase()}/hotspot/`),
    );
    const bridge = str(primaryServer?.interface).toLowerCase().includes("bridge");
    const enabledDhcp = dhcpServers.find(item => item.disabled !== "true");
    const dhcpPool = pools.find(item => str(item.name) === str(enabledDhcp?.["address-pool"]));
    const matchingNetwork = dhcpNetworks.find(item => str(item.gateway) && str(item.address).includes(str(item.gateway).split(".").slice(0, 3).join(".")));
    const dns = dnsRows[0] ?? {};
    const wanInputProtected = filter.some(rule =>
      rule.chain === "input" && ["drop", "reject"].includes(str(rule.action).toLowerCase()) &&
      rule.disabled !== "true" && str(rule["in-interface-list"]).toLowerCase() === "wan",
    );
    const checks = [
      check("connection", "Router / API connectivity", "pass", `Connected to ${found.row.name}; RouterOS ${str(resourceRows[0]?.version) || "version unavailable"}.`),
      check("server", "Hotspot server", servers.length && primaryServer ? primaryServer.disabled === "true" ? "fail" : "pass" : "fail",
        primaryServer ? `${str(primaryServer.name)} on ${str(primaryServer.interface) || "interface not set"}${primaryServer.disabled === "true" ? " (disabled)" : ""}.` : "No Hotspot server was found."),
      check("profile", "Hotspot profile", primaryProfile ? primaryProfile.name === primaryServer?.profile ? "pass" : "warning" : "fail",
        primaryProfile ? `${str(primaryProfile.name)} uses portal directory ${directory}.` : "The selected Hotspot server profile could not be found."),
      check("bridge", "Hotspot bridge / interface binding", bridge ? "pass" : "warning",
        primaryServer ? `Server is bound to ${str(primaryServer.interface)}. ${bridge ? "This appears to be a bridge interface." : "Review the selected interface; this check does not change PPPoE."}` : "No server interface is configured."),
      check("dhcp", "DHCP server and address pool", enabledDhcp ? enabledDhcp.disabled === "true" ? "fail" : dhcpPool ? "pass" : "fail" : "warning",
        enabledDhcp ? `${str(enabledDhcp.name)} on ${str(enabledDhcp.interface)}; pool ${str(enabledDhcp["address-pool"]) || "not set"}${dhcpPool ? " exists" : " is missing"}.` : "No enabled DHCP server was found."),
      check("gateway", "Gateway and DHCP network", matchingNetwork ? "pass" : "warning",
        matchingNetwork ? `Gateway ${str(matchingNetwork.gateway)}; network ${str(matchingNetwork.address)}.` : "No matching DHCP network/gateway was identified."),
      check("dns", "Router DNS", dns["allow-remote-requests"] === "true" ? wanInputProtected ? "pass" : "warning" : "warning",
        `Remote requests ${dns["allow-remote-requests"] === "true" ? "enabled" : "disabled"}; servers ${str(dns.servers) || "not set"}.${dns["allow-remote-requests"] === "true" && !wanInputProtected ? " WAN input protection was not verified." : ""}`),
      check("firewall", "Hotspot NAT / firewall", nat.length ? "warning" : "warning",
        `${nat.length} NAT rule(s) and ${filter.length} filter rule(s) were read. Rule intent/order requires review; no broad firewall changes are suggested automatically.`),
      check("users", "Hotspot users and profiles", userProfiles.length ? "pass" : "warning",
        `${users.length} local Hotspot user(s), ${userProfiles.length} user profile(s) found. PPPoE state is not modified.`),
      check("portal-files", "Login page files", relevantFiles.some(file => file.endsWith("/login.html")) ? relevantFiles.some(file => file.endsWith("/rlogin.html")) ? "pass" : "warning" : "fail",
        `Portal directory ${directory}; ${relevantFiles.length} related file(s) found.`),
    ];
    const partialIssues: string[] = [];
    let layoutSync = "No successful BIL layout deployment is recorded for this router.";
    try {
      const history = await sbSelect<Record<string, unknown>>("isp_hotspot_layout_deployments",
        `admin_id=eq.${adminId}&router_id=eq.${routerId}&select=layout_id,layout_version,status,created_at&order=created_at.desc&limit=1`);
      const latest = history[0];
      if (latest) layoutSync = `Last deployment: ${str(latest.layout_id)} v${str(latest.layout_version)} — ${str(latest.status)} (${str(latest.created_at)}).`;
    } catch {
      partialIssues.push("Layout deployment history could not be loaded.");
    }
    checks.push(check("layout-sync", "Selected layout sync status", "unknown", layoutSync));
    checks.push(check("payment-activation", "Payment → user activation", "unknown",
      "Payment callback and activation state are not evaluated by this router-only scan. Use Transactions and Paid Hotspot Recovery to verify an individual purchase."));
    await logActivity({ adminId, type: "router", action: "hotspot_diagnostics_scan", subject: `Router ${routerId}: ${found.row.name}`, details: { routerId, result: "completed", checkCount: checks.length } });
    let interfaces: string[] = [];
    try {
      interfaces = rows(await runRouterCommand(found.creds, ["/interface/print", "=.proplist=name,disabled"]))
        .filter(item => item.disabled !== "true").map(item => str(item.name)).filter(Boolean);
    } catch {
      partialIssues.push("Interface targets could not be loaded; interface repair is unavailable.");
    }
    res.json({
      router: { id: routerId, name: found.row.name },
      checkedAt: new Date().toISOString(),
      checks,
      partial: partialIssues.length > 0,
      partialIssues,
      repairTargets: {
        servers: servers.map(item => str(item.name)).filter(Boolean),
        profiles: profiles.map(item => str(item.name)).filter(Boolean),
        dhcpServers: dhcpServers.map(item => str(item.name)).filter(Boolean),
        interfaces,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Router diagnostics failed.";
    await logActivity({ adminId, type: "router", action: "hotspot_diagnostics_scan", subject: `Router ${routerId}`, details: { routerId, result: "failed", error: message.slice(0, 250) } });
    res.status(503).json({ error: message });
  }
});

router.post("/router/:id/hotspot-fix/repair", requireAdmin(), async (req, res): Promise<void> => {
  const routerId = Number(req.params.id);
  const adminId = authenticatedAdminId(req, req.body?.adminId);
  const action = str(req.body?.action) as RepairAction;
  const mode = str(req.body?.mode);
  if (!Number.isSafeInteger(routerId) || routerId < 1) { res.status(400).json({ error: "Invalid router id." }); return; }
  if (!adminId) { res.status(403).json({ error: "The signed-in ISP account could not be verified." }); return; }
  if (!ALLOWED_REPAIRS.has(action)) { res.status(400).json({ error: "This repair is not available for automatic changes. Use its dedicated settings page." }); return; }
  const found = await getRouterCreds(routerId, adminId);
  if (!found) { res.status(404).json({ error: "Router not found or not assigned to this tenant." }); return; }
  const target = str(req.body?.target);
  const value = str(req.body?.value);
  const plans: Record<RepairAction, string> = {
    "enable-server": `Enable only Hotspot server "${target}". No profile, bridge, PPPoE, firewall, or user settings will change.`,
    "select-profile": `Set only Hotspot server "${target}" to use existing profile "${value}".`,
    "bind-server": `Bind only Hotspot server "${target}" to existing interface "${value}". This does not create a bridge or alter PPPoE.`,
    "enable-dhcp": `Enable only DHCP server "${target}". Pool ranges, networks and leases will not be changed.`,
    "enable-dns": "Enable RouterOS DNS remote requests only. DNS servers and firewall rules will not be changed.",
  };
  if (mode === "preview") {
    let current: Array<Record<string, unknown>> = [];
    const readPath = action === "enable-server" || action === "bind-server" || action === "select-profile" ? "/ip/hotspot/print"
      : action === "enable-dhcp" ? "/ip/dhcp-server/print" : "/ip/dns/print";
    try {
      current = rows(await runRouterCommand(found.creds, [readPath, "=.proplist=.id,name,interface,profile,disabled,allow-remote-requests"]));
      const selected = action === "enable-dns" ? current[0] : current.find(item => str(item.name) === target);
      if (!selected) { res.status(409).json({ error: "The requested RouterOS resource was not found; no changes were made." }); return; }
      if (action === "bind-server") {
        const interfaces = rows(await runRouterCommand(found.creds, ["/interface/print", "=.proplist=name,disabled"]));
        if (!interfaces.some(item => str(item.name) === value && item.disabled !== "true")) {
          res.status(409).json({ error: "Choose an existing enabled interface as the target." }); return;
        }
      }
      if (action === "select-profile") {
        const availableProfiles = rows(await runRouterCommand(found.creds, ["/ip/hotspot/profile/print", "=.proplist=name"]));
        if (!availableProfiles.some(item => str(item.name) === value)) {
          res.status(409).json({ error: "Choose an existing Hotspot profile as the target." }); return;
        }
      }
      if (action === "enable-dns" && !(await hasWanInputProtection(found.creds))) {
        res.status(409).json({ error: "DNS remote requests were not enabled. A RouterOS input drop/reject rule scoped to interface-list WAN could not be verified; review the firewall manually to avoid creating an open DNS resolver." }); return;
      }
      const confirmationToken = randomBytes(24).toString("hex");
      repairPreviewTokens.set(confirmationToken, { adminId, routerId, action, target, value, expiresAt: Date.now() + 5 * 60_000 });
      res.json({ preview: plans[action], resource: action === "enable-dns" ? "Router DNS" : target, currentState: action === "enable-dns" ? str(selected["allow-remote-requests"]) : action === "select-profile" ? str(selected.profile) : str(selected.disabled), confirmationToken });
    } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Could not preview this repair." }); }
    return;
  }
  const confirmationToken = str(req.body?.confirmationToken);
  if (mode !== "apply" || req.body?.confirmed !== true || !consumeRepairPreview(
      repairPreviewTokens, confirmationToken, { adminId, routerId, action, target, value },
    )) {
    res.status(400).json({ error: "Preview this repair and use its valid confirmation before applying. Previews expire after five minutes." }); return;
  }
  let auditId: number | null = null;
  try {
    let commands: string[][];
    if (action === "enable-dns") {
      if (!(await hasWanInputProtection(found.creds))) {
        res.status(409).json({ error: "DNS remote requests were not enabled because WAN input protection could not be verified." }); return;
      }
      commands = [["/ip/dns/set", "=allow-remote-requests=yes"]];
    } else {
      const path = action === "enable-server" || action === "bind-server" || action === "select-profile" ? "/ip/hotspot/print" : "/ip/dhcp-server/print";
      const current = rows(await runRouterCommand(found.creds, [path, "=.proplist=.id,name,interface,disabled"]));
      const selected = current.find(item => str(item.name) === target);
      if (!selected || !str(selected[".id"])) { res.status(409).json({ error: "The selected resource no longer exists; no changes were made." }); return; }
      if (action === "bind-server") {
        const interfaces = rows(await runRouterCommand(found.creds, ["/interface/print", "=.proplist=name,disabled"]));
        if (!interfaces.some(item => str(item.name) === value && item.disabled !== "true")) { res.status(409).json({ error: "The target interface does not exist or is disabled." }); return; }
        commands = [["/ip/hotspot/set", `=.id=${str(selected[".id"])}`, `=interface=${value}`]];
      } else if (action === "select-profile") {
        const availableProfiles = rows(await runRouterCommand(found.creds, ["/ip/hotspot/profile/print", "=.proplist=name"]));
        if (!availableProfiles.some(item => str(item.name) === value)) { res.status(409).json({ error: "The selected Hotspot profile no longer exists." }); return; }
        commands = [["/ip/hotspot/set", `=.id=${str(selected[".id"])}`, `=profile=${value}`]];
      } else {
        const setPath = action === "enable-server" ? "/ip/hotspot/set" : "/ip/dhcp-server/set";
        commands = [[setPath, `=.id=${str(selected[".id"])}`, "=disabled=no"]];
      }
    }
    const [audit] = await sbInsertStrict<{ id: number }>("isp_activity_logs", {
      admin_id: adminId,
      type: "router",
      action: `hotspot_repair_${action}`,
      subject: `Router ${routerId}: ${found.row.name}`,
      details: { routerId, action, target: action === "enable-dns" ? "router-dns" : target, value: action === "bind-server" || action === "select-profile" ? value : undefined, result: "started" },
    });
    auditId = Number(audit?.id) || null;
    if (!auditId) throw new Error("The repair audit record could not be created; no RouterOS change was made.");
    await runRouterCommand(found.creds, commands[0]);
    await sbUpdateStrict("isp_activity_logs", `id=eq.${auditId}&admin_id=eq.${adminId}`, {
      details: { routerId, action, target: action === "enable-dns" ? "router-dns" : target, value: action === "bind-server" || action === "select-profile" ? value : undefined, result: "success" },
    });
    res.json({ ok: true, message: "The narrowly scoped Hotspot repair was applied. Run diagnostics again to verify it." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hotspot repair failed.";
    if (auditId) {
      await sbUpdateStrict("isp_activity_logs", `id=eq.${auditId}&admin_id=eq.${adminId}`, {
        details: { routerId, action, target, value, result: "failed", error: message.slice(0, 250) },
      }).catch(() => undefined);
    }
    res.status(503).json({ ok: false, error: message });
  }
});

router.get("/router/:id/hotspot-fix/history", requireAdmin(), async (req, res): Promise<void> => {
  const routerId = Number(req.params.id);
  const adminId = authenticatedAdminId(req, req.query.adminId);
  if (!Number.isSafeInteger(routerId) || routerId < 1 || !adminId) { res.status(403).json({ error: "A valid tenant and router are required." }); return; }
  const history = await sbSelect<Record<string, unknown>>("isp_activity_logs",
    `admin_id=eq.${adminId}&type=eq.router&subject=like.${encodeURIComponent(`*Router ${routerId}:*`)}&select=action,subject,details,created_at&order=created_at.desc&limit=30`);
  res.json({ history: history.filter(item => str(item.action).startsWith("hotspot_")) });
});

export default router;
