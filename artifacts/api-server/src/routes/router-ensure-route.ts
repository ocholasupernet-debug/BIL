/**
 * POST /api/admin/router/ensure
 *
 * Creates a router record for an admin if one with the given name doesn't
 * already exist, then returns it. Uses the Supabase service-role key
 * (SUPABASE_SERVICE_KEY) if available — which bypasses Row-Level Security.
 * Falls back to the anon key and handles 409 conflicts by fetching the
 * existing row.
 *
 * Body: { adminId: number, routerName: string, bridgeIp?: string, bridgeInterface?: string }
 * Response: { ok: true, router: { id, name, router_secret, ... } }
 *            { ok: false, error: string, detail?: string }
 */

import { Router, type IRouter } from "express";

const router: IRouter = Router();

/* Prefer VITE_SUPABASE_URL — SUPABASE_URL may be a bare DB hostname without https:// */
function resolveSupabaseUrl(): string {
  const raw = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  if (!raw) return "";
  return raw.startsWith("http") ? raw : `https://${raw}`;
}
const SUPABASE_URL = resolveSupabaseUrl();
/* Prefer service-role key (bypasses RLS); fall back to anon key */
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
const ANON_KEY    = process.env.VITE_SUPABASE_KEY ?? "";
const BEST_KEY    = SERVICE_KEY || ANON_KEY;

function sbHeaders(key: string) {
  return {
    apikey:          key,
    Authorization:   `Bearer ${key}`,
    "Content-Type":  "application/json",
    Accept:          "application/json",
  };
}

function makeSecret(adminId: number): string {
  return Buffer
    .from(`${adminId}:${Date.now()}:ocholanet`)
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 48);
}

router.post("/admin/router/ensure", async (req, res): Promise<void> => {
  if (!SUPABASE_URL || !BEST_KEY) {
    res.status(503).json({ ok: false, error: "Supabase not configured on this server (missing VITE_SUPABASE_URL or VITE_SUPABASE_KEY)" });
    return;
  }

  const { adminId, routerName, bridgeIp, bridgeInterface } = req.body as {
    adminId: number;
    routerName: string;
    bridgeIp?: string;
    bridgeInterface?: string;
  };

  if (!adminId || !routerName) {
    res.status(400).json({ ok: false, error: "adminId and routerName are required" });
    return;
  }

  const name = routerName.trim();

  /* ── 1. Try to find an existing router with this name ── */
  try {
    const existRes = await fetch(
      `${SUPABASE_URL}/rest/v1/isp_routers?admin_id=eq.${adminId}&name=eq.${encodeURIComponent(name)}&select=*&limit=1`,
      { headers: sbHeaders(BEST_KEY) }
    );
    if (existRes.ok) {
      const rows = await existRes.json() as Record<string, unknown>[];
      if (rows.length > 0) {
        res.json({ ok: true, router: rows[0], created: false });
        return;
      }
    }
  } catch (e) {
    console.error("[router/ensure] SELECT failed:", e);
  }

  /* ── 2. Try INSERT (service-role key first, then anon key) ── */
  const keysToTry = SERVICE_KEY ? [SERVICE_KEY, ANON_KEY].filter(Boolean) : [ANON_KEY];
  const secret = makeSecret(adminId);
  const payload = {
    admin_id:         adminId,
    name,
    host:             "",
    router_username:  "admin",
    router_secret:    secret,
    token:            secret,   /* NOT NULL column — same value as router_secret */
    bridge_interface: bridgeInterface || "bridge",
    bridge_ip:        bridgeIp        || "192.168.88.1",
    status:           "offline",
  };

  let lastStatus = 0;
  let lastBody   = "";

  for (const key of keysToTry) {
    try {
      const createRes = await fetch(
        `${SUPABASE_URL}/rest/v1/isp_routers`,
        {
          method: "POST",
          headers: { ...sbHeaders(key), Prefer: "return=representation" },
          body: JSON.stringify(payload),
        }
      );
      lastStatus = createRes.status;
      lastBody   = await createRes.text();

      if (createRes.ok) {
        let rows: Record<string, unknown>[] = [];
        try { rows = JSON.parse(lastBody) as Record<string, unknown>[]; } catch {}
        if (rows.length > 0) {
          console.log(`[router/ensure] Created router "${name}" for admin ${adminId} (key: ${key === SERVICE_KEY ? "service" : "anon"})`);
          res.json({ ok: true, router: rows[0], created: true });
          return;
        }
      }

      /* 409 Conflict → row already exists, fetch it */
      if (createRes.status === 409) {
        const existRes2 = await fetch(
          `${SUPABASE_URL}/rest/v1/isp_routers?admin_id=eq.${adminId}&name=eq.${encodeURIComponent(name)}&select=*&limit=1`,
          { headers: sbHeaders(key) }
        );
        if (existRes2.ok) {
          const rows2 = await existRes2.json() as Record<string, unknown>[];
          if (rows2.length > 0) {
            res.json({ ok: true, router: rows2[0], created: false });
            return;
          }
        }
      }

      console.warn(`[router/ensure] INSERT with key type "${key === SERVICE_KEY ? "service" : "anon"}" returned ${createRes.status}: ${lastBody.slice(0, 300)}`);
    } catch (e) {
      console.error(`[router/ensure] INSERT exception:`, e);
    }
  }

  /* All attempts failed */
  res.status(500).json({
    ok:      false,
    error:   `Failed to create router "${name}" for admin ${adminId}`,
    detail:  `Supabase returned HTTP ${lastStatus}: ${lastBody.slice(0, 500)}`,
    hint:    "Set SUPABASE_SERVICE_KEY (service_role key) in the server environment to bypass Row-Level Security.",
  });
});

export default router;
