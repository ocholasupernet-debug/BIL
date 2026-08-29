import { Router, type IRouter, type Request, type Response } from "express";
import { requireAdmin } from "../lib/api-auth.js";
import { sbSelect, sbUpdate } from "../lib/supabase-client.js";
import { TENANT_BASE_DOMAIN } from "../lib/tenant-host.js";

const router: IRouter = Router();

export const TYPOGRAPHY_DEFAULTS = {
  fontFamily: "DM Sans",
  fontStyle: "normal",
  fontWeight: 500,
  fontSize: 18,
} as const;

const FONT_FAMILIES = new Set([
  "DM Sans", "Inter", "Roboto", "Open Sans", "Lato", "Montserrat",
  "Poppins", "Nunito", "Source Sans 3", "Merriweather", "Georgia",
  "Arial", "Verdana", "Trebuchet MS", "Courier New",
]);
const FONT_STYLES = new Set(["normal", "italic", "oblique"]);
const FONT_WEIGHTS = new Set([400, 500, 600, 700, 800]);
const DEFAULT_PORTAL_ACCENT = "#d96835";

interface TypographyRow {
  id?: number;
  is_active?: boolean;
  subdomain?: string | null;
  font_family?: string | null;
  font_style?: string | null;
  font_weight?: number | null;
  font_size?: number | null;
}

export function normalizeTypography(row?: TypographyRow | null) {
  return {
    fontFamily: typeof row?.font_family === "string" && FONT_FAMILIES.has(row.font_family)
      ? row.font_family : TYPOGRAPHY_DEFAULTS.fontFamily,
    fontStyle: typeof row?.font_style === "string" && FONT_STYLES.has(row.font_style)
      ? row.font_style : TYPOGRAPHY_DEFAULTS.fontStyle,
    fontWeight: typeof row?.font_weight === "number" && FONT_WEIGHTS.has(row.font_weight)
      ? row.font_weight : TYPOGRAPHY_DEFAULTS.fontWeight,
    fontSize: typeof row?.font_size === "number" && Number.isInteger(row.font_size) && row.font_size >= 12 && row.font_size <= 24
      ? row.font_size : TYPOGRAPHY_DEFAULTS.fontSize,
  };
}

function normalizeAccent(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : DEFAULT_PORTAL_ACCENT;
}

function adminId(req: Request): number {
  const id = Number(req.authUser?.uid);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid administrator identity.");
  return id;
}

function apiBase(req: Request, subdomain?: string | null): string {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host")?.trim() || "";
  const isLocalHost = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)(?::\d+)?$/i.test(host);
  if (host && !isLocalHost) {
    return `${forwardedProto || req.protocol}://${host}`;
  }
  if (typeof subdomain === "string" && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(subdomain)) {
    return `https://${subdomain.toLowerCase()}.${TENANT_BASE_DOMAIN}`;
  }
  return `https://${TENANT_BASE_DOMAIN}`;
}

async function readTypography(id: number) {
  const rows = await sbSelect<TypographyRow>(
    "isp_admins",
    `id=eq.${id}&is_active=is.true&select=subdomain,font_family,font_style,font_weight,font_size&limit=1`,
  );
  return {
    preferences: normalizeTypography(rows[0]),
    subdomain: rows[0]?.subdomain ?? null,
  };
}

async function readPortalAccent(id: number): Promise<string> {
  try {
    const rows = await sbSelect<{ accent_color?: string | null }>(
      "isp_dashboard_preferences",
      `admin_id=eq.${id}&select=accent_color&limit=1`,
    );
    return normalizeAccent(rows[0]?.accent_color);
  } catch {
    return DEFAULT_PORTAL_ACCENT;
  }
}

/* Public by design: these values contain no account or credential data and are
   needed by router-served captive portals before a customer can sign in. */
router.get("/public/typography", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.query.adminId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ ok: false, error: "A valid ISP context is required." });
    return;
  }
  try {
    const [result, accentColor] = await Promise.all([
      readTypography(id),
      readPortalAccent(id),
    ]);
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, adminId: id, ...result.preferences, accentColor, apiBase: apiBase(req, result.subdomain) });
  } catch {
    res.status(503).json({ ok: false, error: "Typography preferences are temporarily unavailable." });
  }
});

router.get("/admin/typography", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  try {
    res.set("Cache-Control", "no-store");
    const result = await readTypography(adminId(req));
    res.json({ ok: true, preferences: result.preferences });
  } catch {
    res.status(503).json({ ok: false, error: "Typography preferences could not be loaded. Confirm the typography migration has been applied." });
  }
});

router.put("/admin/typography", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  const input = req.body?.preferences;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    res.status(400).json({ ok: false, error: "Typography preferences are required." });
    return;
  }

  const { fontFamily, fontStyle, fontWeight, fontSize } = input as Record<string, unknown>;
  if (typeof fontFamily !== "string" || !FONT_FAMILIES.has(fontFamily)) {
    res.status(400).json({ ok: false, error: "Choose a supported font family." });
    return;
  }
  if (typeof fontStyle !== "string" || !FONT_STYLES.has(fontStyle)) {
    res.status(400).json({ ok: false, error: "Choose a supported font style." });
    return;
  }
  if (typeof fontWeight !== "number" || !Number.isInteger(fontWeight) || !FONT_WEIGHTS.has(fontWeight)) {
    res.status(400).json({ ok: false, error: "Choose a supported font weight." });
    return;
  }
  if (typeof fontSize !== "number" || !Number.isInteger(fontSize) || fontSize < 12 || fontSize > 24) {
    res.status(400).json({ ok: false, error: "Font size must be a whole number between 12 and 24 pixels." });
    return;
  }

  try {
    const id = adminId(req);
    const rows = await sbUpdate<TypographyRow>("isp_admins", `id=eq.${id}`, {
      font_family: fontFamily,
      font_style: fontStyle,
      font_weight: fontWeight,
      font_size: fontSize,
      updated_at: new Date().toISOString(),
    });
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, preferences: normalizeTypography(rows[0]) });
  } catch {
    res.status(503).json({ ok: false, error: "Typography preferences could not be saved. Confirm the typography migration has been applied." });
  }
});

export default router;