import { Router, type IRouter, type Request, type Response } from "express";
import {
  ADMIN_PAGE_VISIBILITY_CATALOG,
  ADMIN_PAGE_VISIBILITY_KEYS,
  DEFAULT_ADMIN_PAGE_VISIBILITY,
} from "../lib/admin-page-visibility.js";
import { extractToken, validateToken } from "../lib/api-auth.js";
import { sbSelect, sbUpsertStrict } from "../lib/supabase-client.js";
import { activeSuperAdminName, isActiveSuperAdminToken } from "./super-admin-auth-route.js";

const router: IRouter = Router();

interface VisibilityRow {
  feature_key: string;
  enabled: boolean;
}

function mergedVisibility(rows: VisibilityRow[]): Record<string, boolean> {
  const visibility = { ...DEFAULT_ADMIN_PAGE_VISIBILITY };
  for (const row of rows) {
    if (ADMIN_PAGE_VISIBILITY_KEYS.has(row.feature_key) && typeof row.enabled === "boolean") {
      visibility[row.feature_key] = row.enabled;
    }
  }
  /* The Dashboard is always the safe destination for a blocked page. */
  visibility["overview.dashboard"] = true;
  visibility.overview = true;
  return visibility;
}

function requireSuperAdmin(req: Request, res: Response): string | null {
  const token = String(req.headers["x-sa-token"] ?? "");
  const name = activeSuperAdminName(token);
  if (!name) {
    res.status(401).json({ ok: false, error: "Super Admin authentication required." });
    return null;
  }
  return name;
}

function requireAdminOrSuperAdmin(req: Request, res: Response): boolean {
  const token = extractToken(req);
  const payload = validateToken(token);
  if (payload?.type === "a" || isActiveSuperAdminToken(token)) return true;
  res.status(401).json({ ok: false, error: "Administrator authentication required." });
  return false;
}

async function readVisibility(): Promise<Record<string, boolean>> {
  const rows = await sbSelect<VisibilityRow>(
    "admin_page_visibility",
    "select=feature_key,enabled",
  );
  return mergedVisibility(rows);
}

router.get("/admin/page-visibility", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminOrSuperAdmin(req, res)) return;
  try {
    res.json({ ok: true, visibility: await readVisibility() });
  } catch {
    /* The admin panel is fail-open when the optional settings table is unavailable. */
    res.json({ ok: true, visibility: { ...DEFAULT_ADMIN_PAGE_VISIBILITY } });
  }
});

router.get("/super-admin/admin-page-visibility", async (req: Request, res: Response): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    res.json({
      ok: true,
      catalog: ADMIN_PAGE_VISIBILITY_CATALOG,
      visibility: await readVisibility(),
    });
  } catch {
    res.status(503).json({ ok: false, error: "Visibility settings could not be loaded." });
  }
});

router.put("/super-admin/admin-page-visibility", async (req: Request, res: Response): Promise<void> => {
  const superAdminName = requireSuperAdmin(req, res);
  if (!superAdminName) return;

  const input = req.body?.visibility;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    res.status(400).json({ ok: false, error: "A visibility settings object is required." });
    return;
  }

  const entries = Object.entries(input as Record<string, unknown>);
  const unknownKey = entries.find(([key]) => !ADMIN_PAGE_VISIBILITY_KEYS.has(key));
  if (unknownKey) {
    res.status(400).json({ ok: false, error: `Unsupported visibility key: ${unknownKey[0]}.` });
    return;
  }
  const invalidValue = entries.find(([, value]) => typeof value !== "boolean");
  if (invalidValue) {
    res.status(400).json({ ok: false, error: "Visibility values must be true or false." });
    return;
  }
  if (input["overview.dashboard"] === false || input.overview === false) {
    res.status(400).json({ ok: false, error: "The admin Dashboard must remain enabled." });
    return;
  }

  try {
    await Promise.all(entries.map(([feature_key, enabled]) =>
      sbUpsertStrict(
        "admin_page_visibility",
        "feature_key",
        { feature_key, enabled, updated_by: superAdminName, updated_at: new Date().toISOString() },
      ),
    ));
    res.json({ ok: true, visibility: mergedVisibility(entries.map(([feature_key, enabled]) => ({ feature_key, enabled: enabled as boolean }))) });
  } catch {
    res.status(503).json({ ok: false, error: "Visibility settings could not be saved. Confirm the database migration has been applied." });
  }
});

export default router;