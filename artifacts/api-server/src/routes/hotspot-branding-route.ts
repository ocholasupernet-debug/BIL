import { Router, type IRouter, type Request, type Response } from "express";
import { requireAdmin } from "../lib/api-auth.js";
import { sbSelect, sbUpsertStrict } from "../lib/supabase-client.js";

const router: IRouter = Router();
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const DEFAULTS = { portalHostname: "", settings: {} as Record<string, unknown> };
const SAFE_SETTINGS = new Set([
  "ispName", "freeTrial", "vouchers", "tagline", "routerId", "advertPos", "enableAdvert",
  "mpesaPrompt", "testimonials", "faqSection", "logoUrl", "advertUrl", "announcement",
  "paymentInstructions", "supportPhone", "supportEmail", "whatsappNumber", "termsUrl",
  "privacyUrl", "maintenanceMode", "maintenanceMessage", "testimonialText", "faqText", "colors",
]);

function accountId(req: Request): number {
  const id = Number(req.authUser?.uid);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid administrator identity.");
  return id;
}

function normalize(row?: { portal_hostname?: string | null; settings?: unknown } | null) {
  const settings = safeSettings(row?.settings);
  return {
    portalHostname: typeof row?.portal_hostname === "string" ? row.portal_hostname : DEFAULTS.portalHostname,
    settings,
  };
}

function safeSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULTS.settings;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of SAFE_SETTINGS) {
    const item = input[key];
    if (key === "colors") {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const colors: Record<string, string> = {};
      for (const [name, color] of Object.entries(item)) {
        if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(name) && typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) colors[name] = color.toLowerCase();
      }
      output.colors = colors;
    } else if (typeof item === "string" && item.length <= 2_000_000) {
      output[key] = item;
    }
  }
  return output;
}

async function read(id: number) {
  const rows = await sbSelect<{ portal_hostname?: string | null; settings?: unknown }>(
    "isp_hotspot_branding", `admin_id=eq.${id}&select=portal_hostname,settings&limit=1`,
  );
  return normalize(rows[0]);
}

router.get("/admin/hotspot-branding", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, branding: await read(accountId(req)) });
  } catch {
    res.status(503).json({ ok: false, error: "Hotspot branding could not be loaded. Confirm the branding migration has been applied." });
  }
});

router.put("/admin/hotspot-branding", requireAdmin(), async (req: Request, res: Response): Promise<void> => {
  const input = req.body?.branding;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    res.status(400).json({ ok: false, error: "Hotspot branding is required." });
    return;
  }
  const portalHostname = String(input.portalHostname ?? "").trim().toLowerCase();
  if (portalHostname && (!HOSTNAME.test(portalHostname) || portalHostname.includes(".."))) {
    res.status(400).json({ ok: false, error: "Portal hostname must be a valid DNS hostname." });
    return;
  }
  const settings = input.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings) || JSON.stringify(settings).length > 2_000_000) {
    res.status(400).json({ ok: false, error: "Portal settings must be a JSON object smaller than 2 MB." });
    return;
  }
  try {
    const id = accountId(req);
    const rows = await sbUpsertStrict<{ portal_hostname: string | null; settings: unknown }>(
      "isp_hotspot_branding",
      "admin_id",
      { admin_id: id, portal_hostname: portalHostname || null, settings: safeSettings(settings), updated_at: new Date().toISOString() },
    );
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, branding: normalize(rows[0]) });
  } catch {
    res.status(503).json({ ok: false, error: "Hotspot branding could not be saved. Confirm the branding migration has been applied." });
  }
});

router.get("/public/hotspot-branding", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.query.adminId);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ ok: false, error: "A valid ISP context is required." });
    return;
  }
  try {
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, adminId: id, branding: await read(id) });
  } catch {
    res.status(503).json({ ok: false, error: "Hotspot branding is temporarily unavailable." });
  }
});

export default router;