import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/* Safe diagnostics — shows which env vars are set (never values) */
router.get("/debug/env", (_req, res) => {
  const check = (key: string) => {
    const v = process.env[key];
    if (!v) return "missing";
    if (v.length < 4) return "too-short";
    return `set(${v.length})`;
  };
  res.json({
    SUPABASE_URL:         check("SUPABASE_URL"),
    VITE_SUPABASE_URL:    check("VITE_SUPABASE_URL"),
    SUPABASE_SERVICE_KEY: check("SUPABASE_SERVICE_KEY"),
    VITE_SUPABASE_KEY:    check("VITE_SUPABASE_KEY"),
    HB_URL_resolved:      !!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
    HB_KEY_resolved:      !!(process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_KEY),
    NODE_ENV:             process.env.NODE_ENV ?? "not-set",
    PORT:                 process.env.PORT ?? "not-set",
  });
});

export default router;
