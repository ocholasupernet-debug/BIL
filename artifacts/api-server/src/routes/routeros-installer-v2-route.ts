import { Router, type IRouter } from "express";
import { requireAdmin, authenticatedAdminId } from "../lib/api-auth.js";
import { getRouterCreds } from "./mikrotik-route.js";
import { sbSelectStrict } from "../lib/supabase-client.js";
import {
  buildInstallerV2EntryUrl,
  buildInstallerV2PreflightScript,
  ROUTEROS_INSTALLER_V2_VERSION,
} from "../services/routeros-installer-v2.js";

const apiRouter: IRouter = Router();
export const routerosInstallerV2PublicRouter: IRouter = Router();

function escapeFilter(value: string): string {
  return encodeURIComponent(value);
}

apiRouter.post("/router/:id/installer-v2/enrollment", requireAdmin(), async (req, res): Promise<void> => {
  const routerId = Number(req.params.id);
  const adminId = authenticatedAdminId(req);
  if (!Number.isSafeInteger(routerId) || routerId <= 0 || !Number.isSafeInteger(adminId) || adminId <= 0) {
    res.status(400).json({ error: "A valid tenant router and signed-in admin are required." });
    return;
  }
  try {
    const found = await getRouterCreds(routerId, adminId);
    if (!found) {
      res.status(404).json({ error: "Router not found for this tenant." });
      return;
    }
    const admins = await sbSelectStrict<{ subdomain: string | null }>(
      "isp_admins",
      `id=eq.${encodeURIComponent(adminId)}&is_active=is.true&select=subdomain&limit=1`,
    );
    const origin = buildInstallerV2EntryUrl(process.env.PUBLIC_APP_ORIGIN, admins[0]?.subdomain);
    if (!origin) {
      res.status(503).json({ error: "A valid company subdomain and HTTPS BIL origin are required before issuing installer URLs." });
      return;
    }
    const entryUrl = origin;
    const command = `:do { /tool fetch url="${entryUrl}" dst-path="mainhotspot-v2.rsc" mode=https check-certificate=yes; :delay 2s; /import "mainhotspot-v2.rsc" } on-error={ :put ("BIL v2 preflight download/import failed: " . $error) }`;
    res.set("Cache-Control", "no-store").json({
      release: ROUTEROS_INSTALLER_V2_VERSION,
      routerId,
      entryUrl,
      command,
      mode: "preflight-only",
      warning: "This v2 release creates a local backup/export and prints discovery only. It does not apply router configuration; the apply gate is closed pending non-production RouterOS validation.",
    });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not issue a v2 enrollment token." });
  }
});

routerosInstallerV2PublicRouter.get("/scripts/v2/mainhotspot.rsc", async (_req, res): Promise<void> => {
  res
    .status(200)
    .type("text/plain")
    .set("Content-Disposition", 'attachment; filename="mainhotspot.rsc"')
    .set("Cache-Control", "no-store, no-cache, must-revalidate")
    .set("X-Content-Type-Options", "nosniff")
    .send(buildInstallerV2PreflightScript());
});

export default apiRouter;
