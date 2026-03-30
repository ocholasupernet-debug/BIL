import { Router, type IRouter } from "express";
import { sbSelect } from "../lib/supabase-client.js";

const router: IRouter = Router();

interface ActivityLog {
  id: number;
  admin_id: number;
  type: string;
  action: string;
  subject: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

/* GET /api/logs?adminId=N&limit=N&type=router|plan|customer|provision|system */
router.get("/logs", async (req, res): Promise<void> => {
  const adminId = req.query.adminId ?? req.query.ispId ?? "1";
  const limit   = Math.min(Number(req.query.limit ?? 200), 500);
  const type    = req.query.type as string | undefined;

  let query = `admin_id=eq.${adminId}&order=created_at.desc&limit=${limit}`;
  if (type && type !== "all") query += `&type=eq.${encodeURIComponent(type)}`;

  const rows = await sbSelect<ActivityLog>("isp_activity_logs", query);
  res.json(rows);
});

export default router;
