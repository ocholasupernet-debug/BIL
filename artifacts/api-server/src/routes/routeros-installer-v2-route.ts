import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { requireAdmin, authenticatedAdminId } from "../lib/api-auth.js";
import { getRouterCreds } from "./mikrotik-route.js";
import { sbInsertStrict, sbSelectStrict, sbUpdateStrict } from "../lib/supabase-client.js";
import {
  buildInstallerV2EntryUrl,
  buildInstallerV2PreflightScript,
  ROUTEROS_INSTALLER_V2_VERSION,
} from "../services/routeros-installer-v2.js";

const apiRouter: IRouter = Router();
export const routerosInstallerV2PublicRouter: IRouter = Router();
const TABLE = "routeros_installer_v2_enrollments";
const TOKEN_TTL_MS = 10 * 60 * 1000;

type EnrollmentRow = {
  token_hash: string;
  router_id: number;
  admin_id: number;
  release: string;
  expires_at: string;
  status: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

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
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    await sbInsertStrict(TABLE, {
      token_hash: tokenHash,
      admin_id: adminId,
      router_id: routerId,
      release: ROUTEROS_INSTALLER_V2_VERSION,
      status: "issued",
      expires_at: expiresAt,
    });
    const entryUrl = `${origin}?token=${encodeURIComponent(token)}`;
    const command = `:do { /tool fetch url="${entryUrl}" dst-path="mainhotspot-v2.rsc" mode=https check-certificate=yes; :delay 2s; /import "mainhotspot-v2.rsc" } on-error={ :put ("BIL v2 preflight download/import failed: " . $error) }`;
    res.set("Cache-Control", "no-store").json({
      release: ROUTEROS_INSTALLER_V2_VERSION,
      routerId,
      expiresAt,
      entryUrl,
      command,
      mode: "preflight-only",
      warning: "This v2 release creates a local backup/export and prints discovery only. It does not apply router configuration; the apply gate is closed pending non-production RouterOS validation.",
    });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Could not issue a v2 enrollment token." });
  }
});

routerosInstallerV2PublicRouter.get("/scripts/v2/mainhotspot.rsc", async (req, res): Promise<void> => {
  const token = String(req.query.token ?? "");
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) {
    res.status(404).type("text").send("Installer enrollment token is invalid or expired.\n");
    return;
  }
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();
  try {
    const found = await sbSelectStrict<EnrollmentRow>(
      TABLE,
      `token_hash=eq.${escapeFilter(tokenHash)}&status=eq.issued&expires_at=gt.${encodeURIComponent(now)}&select=token_hash,router_id,admin_id,release,expires_at,status&limit=1`,
    );
    if (!found[0] || found[0].release !== ROUTEROS_INSTALLER_V2_VERSION) {
      res.status(404).type("text").send("Installer enrollment token is invalid, expired, or already used.\n");
      return;
    }
    const consumed = await sbUpdateStrict<EnrollmentRow>(
      TABLE,
      `token_hash=eq.${escapeFilter(tokenHash)}&status=eq.issued&expires_at=gt.${encodeURIComponent(now)}`,
      {
        status: "consumed",
        fetched_at: now,
        source_ip: String(req.ip ?? "").slice(0, 64),
        user_agent: String(req.get("user-agent") ?? "").slice(0, 240),
      },
    );
    if (!consumed.length) {
      res.status(404).type("text").send("Installer enrollment token was already used.\n");
      return;
    }
    res
      .status(200)
      .type("text/plain")
      .set("Content-Disposition", 'attachment; filename="mainhotspot.rsc"')
      .set("Cache-Control", "no-store, no-cache, must-revalidate")
      .set("X-Content-Type-Options", "nosniff")
      .send(buildInstallerV2PreflightScript());
  } catch {
    res.status(503).type("text").send("Installer enrollment is temporarily unavailable; no configuration was applied.\n");
  }
});

export default apiRouter;
