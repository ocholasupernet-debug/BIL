import { Router, type IRouter, type Request, type Response } from "express";
import { sbDeleteStrict, sbSelectStrict, sbUpdateStrict } from "../lib/supabase-client.js";
import { activeSuperAdminName } from "./super-admin-auth-route.js";

const router: IRouter = Router();

function authorized(req: Request, res: Response): boolean {
  if (!activeSuperAdminName(String(req.headers["x-sa-token"] ?? ""))) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return false;
  }
  res.setHeader("Cache-Control", "no-store");
  return true;
}

router.get("/super-admin/admins", async (req: Request, res: Response): Promise<void> => {
  if (!authorized(req, res)) return;
  try {
    const admins = await sbSelectStrict<Record<string, unknown>>(
      "isp_admins",
      "select=id,name,username,email,phone,is_active,role,subdomain,created_at&order=id.asc",
    );
    res.json({ ok: true, admins });
  } catch {
    res.status(503).json({ ok: false, error: "ISP administrator records could not be loaded." });
  }
});

router.get("/super-admin/platform-data", async (req: Request, res: Response): Promise<void> => {
  if (!authorized(req, res)) return;
  try {
    const [admins, routers, customers, plans] = await Promise.all([
      sbSelectStrict<Record<string, unknown>>(
        "isp_admins",
        "select=id,name,username,email,is_active,subdomain,role,created_at&order=id.asc",
      ),
      sbSelectStrict<Record<string, unknown>>(
        "isp_routers",
        "select=id,name,host,status,admin_id,created_at&order=id.asc",
      ),
      sbSelectStrict<Record<string, unknown>>(
        "isp_customers",
        "select=id,admin_id,is_active,type,created_at&order=id.asc",
      ),
      sbSelectStrict<Record<string, unknown>>(
        "isp_plans",
        "select=id,admin_id,type,price&order=id.asc",
      ),
    ]);
    res.json({ ok: true, admins, routers, customers, plans });
  } catch {
    res.status(503).json({ ok: false, error: "Platform reporting data could not be loaded." });
  }
});

router.patch("/super-admin/admins/:id/status", async (req: Request, res: Response): Promise<void> => {
  if (!authorized(req, res)) return;
  const id = Number(req.params.id);
  const isActive = req.body?.is_active;
  if (!Number.isSafeInteger(id) || id <= 0 || typeof isActive !== "boolean") {
    res.status(400).json({ ok: false, error: "A valid administrator ID and active status are required." });
    return;
  }
  try {
    const rows = await sbUpdateStrict<Record<string, unknown>>(
      "isp_admins",
      `id=eq.${id}`,
      { is_active: isActive, updated_at: new Date().toISOString() },
    );
    if (!rows[0]) {
      res.status(404).json({ ok: false, error: "ISP administrator was not found." });
      return;
    }
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: "Administrator status could not be updated." });
  }
});

router.delete("/super-admin/admins/:id", async (req: Request, res: Response): Promise<void> => {
  if (!authorized(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, error: "A valid administrator ID is required." });
    return;
  }
  try {
    const existing = await sbSelectStrict<{ id: number }>(
      "isp_admins",
      `id=eq.${id}&select=id&limit=1`,
    );
    if (!existing[0]) {
      res.status(404).json({ ok: false, error: "ISP administrator was not found." });
      return;
    }
    await sbDeleteStrict("isp_admins", `id=eq.${id}`);
    res.json({ ok: true });
  } catch {
    res.status(409).json({
      ok: false,
      error: "This ISP administrator could not be removed. Check dependent records or deactivate the account instead.",
    });
  }
});

export default router;
