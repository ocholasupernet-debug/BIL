import { Router, type IRouter } from "express";
import { execFile } from "node:child_process";
import { authenticatedAdminId, requireAdmin } from "../lib/api-auth.js";
import { logger } from "../lib/logger.js";
import { sbSelectStrict } from "../lib/supabase-client.js";

const router: IRouter = Router();
const PROVISION_SCRIPT = "/usr/local/bin/ols-provision-subdomain.sh";
const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

router.post("/isp/provision", requireAdmin(), async (req, res): Promise<void> => {
  const adminId = authenticatedAdminId(req, req.body?.adminId);
  if (!adminId) {
    res.status(403).json({ error: "An active tenant administrator is required." });
    return;
  }

  const slug = typeof req.body?.slug === "string" ? req.body.slug.trim().toLowerCase() : "";
  if (!SUBDOMAIN_PATTERN.test(slug)) {
    res.status(400).json({ error: "Invalid slug" });
    return;
  }

  try {
    const admins = await sbSelectStrict<{
      subdomain: string | null;
      parent_id: number | null;
      role: string | null;
    }>(
      "isp_admins",
      `id=eq.${adminId}&select=subdomain,parent_id,role&limit=1`,
    );
    const admin = admins[0];
    if (
      !admin
      || admin.parent_id !== null
      || admin.role === "reseller"
      || admin.subdomain?.trim().toLowerCase() !== slug
    ) {
      res.status(403).json({ error: "You can only provision your own tenant hostname." });
      return;
    }

    execFile("bash", [PROVISION_SCRIPT, slug], { timeout: 30_000, maxBuffer: 256 * 1024 }, error => {
      if (error) {
        logger.error({ err: error, adminId }, "Tenant hostname provisioning failed");
        res.status(500).json({ error: "Provisioning failed." });
        return;
      }
      res.json({ ok: true, slug });
    });
  } catch (error) {
    logger.error({ err: error, adminId }, "Could not authorize tenant hostname provisioning");
    res.status(503).json({ error: "Provisioning could not be verified." });
  }
});

export default router;
