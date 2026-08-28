import { Router, type IRouter, type Request, type Response } from "express";
import { requireAdmin } from "../lib/api-auth.js";
import { sbSelect, sbUpsertStrict } from "../lib/supabase-client.js";

const router: IRouter = Router();

const DEFAULT_PREFERENCES = {
  accentColor: "#d96835",
  layout: "balanced",
  cardShape: "rounded",
} as const;

const LAYOUTS = new Set(["balanced", "focus", "compact"]);
const CARD_SHAPES = new Set(["rounded", "soft-square", "compact"]);

interface DashboardPreferenceRow {
  admin_id: number;
  accent_color: string;
  layout: string;
  card_shape: string;
}

function adminId(req: Request): number {
  const id = Number(req.authUser?.uid);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid administrator identity.");
  return id;
}

function normalizePreferences(row?: Partial<DashboardPreferenceRow> | null) {
  const accentColor = typeof row?.accent_color === "string" && /^#[0-9a-f]{6}$/i.test(row.accent_color)
    ? row.accent_color.toLowerCase()
    : DEFAULT_PREFERENCES.accentColor;
  return {
    accentColor,
    layout: typeof row?.layout === "string" && LAYOUTS.has(row.layout) ? row.layout : DEFAULT_PREFERENCES.layout,
    cardShape: typeof row?.card_shape === "string" && CARD_SHAPES.has(row.card_shape) ? row.card_shape : DEFAULT_PREFERENCES.cardShape,
  };
}

async function readPreferences(id: number) {
  const rows = await sbSelect<DashboardPreferenceRow>(
    "isp_dashboard_preferences",
    `admin_id=eq.${id}&select=accent_color,layout,card_shape&limit=1`,
  );
  return normalizePreferences(rows[0]);
}

router.get("/admin/dashboard-preferences", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  try {
    res.json({ ok: true, preferences: await readPreferences(adminId(req)) });
  } catch {
    res.json({ ok: true, preferences: DEFAULT_PREFERENCES });
  }
});

router.put("/admin/dashboard-preferences", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  const input = req.body?.preferences;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    res.status(400).json({ ok: false, error: "Dashboard preferences are required." });
    return;
  }

  const { accentColor, layout, cardShape } = input as Record<string, unknown>;
  if (typeof accentColor !== "string" || !/^#[0-9a-f]{6}$/i.test(accentColor)) {
    res.status(400).json({ ok: false, error: "Choose a valid six-digit dashboard color." });
    return;
  }
  if (typeof layout !== "string" || !LAYOUTS.has(layout)) {
    res.status(400).json({ ok: false, error: "Choose a supported dashboard layout." });
    return;
  }
  if (typeof cardShape !== "string" || !CARD_SHAPES.has(cardShape)) {
    res.status(400).json({ ok: false, error: "Choose a supported dashboard card shape." });
    return;
  }

  try {
    const saved = await sbUpsertStrict(
      "isp_dashboard_preferences",
      "admin_id",
      {
        admin_id: adminId(req),
        accent_color: accentColor.toLowerCase(),
        layout,
        card_shape: cardShape,
        updated_at: new Date().toISOString(),
      },
    );
    res.json({ ok: true, preferences: normalizePreferences(saved[0] as DashboardPreferenceRow | undefined) });
  } catch {
    res.status(503).json({ ok: false, error: "Dashboard appearance could not be saved. Confirm the dashboard preferences migration has been applied." });
  }
});

export default router;