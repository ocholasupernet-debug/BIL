import { Router, type IRouter, type Request, type Response } from "express";
import { isActiveSuperAdminToken } from "./super-admin-auth-route.js";
import {
  publicPlatformRadiusSettings,
  readPlatformRadiusSettings,
  savePlatformRadiusSettings,
} from "../lib/platform-radius.js";

const router: IRouter = Router();

function requireSuperAdmin(req: Request, res: Response): boolean {
  const token = typeof req.headers["x-sa-token"] === "string" ? req.headers["x-sa-token"] : "";
  if (isActiveSuperAdminToken(token)) return true;
  res.status(401).json({ ok: false, error: "An active Super Admin session is required." });
  return false;
}

function isInputError(message: string): boolean {
  return /^(Enter |RADIUS )/.test(message);
}

router.get("/super-admin/radius-settings", async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const { settings, source } = await readPlatformRadiusSettings();
    res.json({ ok: true, settings: publicPlatformRadiusSettings(settings, source) });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "RADIUS settings could not be loaded.",
    });
  }
});

router.put("/super-admin/radius-settings", async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const settings = await savePlatformRadiusSettings(req.body);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, settings: publicPlatformRadiusSettings(settings, "database") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RADIUS settings could not be saved.";
    res.status(isInputError(message) ? 400 : 503).json({ ok: false, error: message });
  }
});

export default router;
