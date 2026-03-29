import { Router, type IRouter } from "express";
import { sbSelect, sbInsert, sbUpdate, sbDelete } from "../lib/supabase-client";

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
  res.json(r);
});

router.delete("/routers/:id", async (req, res): Promise<void> => {
  const id = req.params.id;
  await sbDelete("isp_routers", `id=eq.${id}`);
  res.sendStatus(204);
});

export default router;
