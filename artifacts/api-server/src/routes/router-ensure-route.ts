/**
 * POST /api/admin/router/ensure
 *
 * Creates a router record for an admin if one with the given name doesn't
 * already exist, then returns it. Uses the Supabase service-role key
 * (SUPABASE_SERVICE_KEY) if available — which bypasses Row-Level Security.
 * Falls back to the anon key and handles 409 conflicts by fetching the
 * existing row.
 *
 * Body: { adminId: number, routerName?: string, bridgeIp?: string, bridgeInterface?: string }
 * Response: { ok: true, router: { id, name, router_secret, ... } }
 *            { ok: false, error: string, detail?: string }
 */

import { Router, type IRouter } from "express";
import { allocateRouterVpnIp, isRouterVpnIp } from "../lib/router-vpn-ip.js";
import { readIppEntries } from "../lib/vpn-status.js";
import { authenticatedAdminId, requireAdmin } from "../lib/api-auth.js";
import { getTenantSubdomain } from "../lib/tenant-host.js";

const router: IRouter = Router();

/* Prefer VITE_SUPABASE_URL — SUPABASE_URL may be a bare DB hostname without https:// */
function resolveSupabaseUrl(): string {
  const raw = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  if (!raw) return "";
  return raw.startsWith("http") ? raw : `https://${raw}`;
}
const SUPABASE_URL = resolveSupabaseUrl();
/* Prefer service-role key (bypasses RLS); fall back to anon key */
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
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

function routerNameBase(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = slug.slice(0, 27).replace(/-+$/g, "");
  if (!base) throw new Error("A tenant subdomain is required before creating a router");
  return base;
}

async function nextCompanyRouterName(adminId: number, requestHost: string): Promise<string> {
  const requestTenant = getTenantSubdomain(requestHost);
  let base = requestTenant ? routerNameBase(requestTenant) : "";
  try {
    const adminRes = await fetch(
      `${SUPABASE_URL}/rest/v1/isp_admins?id=eq.${adminId}&select=name,subdomain&limit=1`,
      { headers: sbHeaders(BEST_KEY) },
    );
    if (adminRes.ok) {
      const admins = await adminRes.json() as Array<{ name?: string | null; subdomain?: string | null }>;
      const admin = admins[0];
      if (admin?.subdomain) base = routerNameBase(admin.subdomain);
    }
  } catch {
    /* Use the verified tenant host when the admin lookup is temporarily
       unavailable; never fall back to a generic router prefix. */
  }
  if (!base) throw new Error("Could not resolve the signed-in tenant subdomain");

  const usedRes = await fetch(
    `${SUPABASE_URL}/rest/v1/isp_routers?admin_id=eq.${adminId}&select=name`,
    { headers: sbHeaders(BEST_KEY) },
  );
  if (!usedRes.ok) throw new Error(`Could not inspect existing router names (${usedRes.status})`);
  const usedRows = await usedRes.json() as Array<{ name?: string | null }>;
  const used = new Set(usedRows.map(row => String(row.name ?? "").trim().toLowerCase()));
  for (let ordinal = 1; ordinal <= 9999; ordinal += 1) {
    const candidate = `${base}${ordinal}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error(`No available router name remains for company prefix "${base}"`);
}

/* Credentials are consumed by server-side RouterOS routes and by the
 * generated installer only. Never return them to the admin browser. */
function publicRouter(row: Record<string, unknown>): Record<string, unknown> {
  const {
    router_secret: _routerSecret,
    token: _token,
    password: _password,
    ...safe
  } = row;
  return safe;
}

async function allocatePersistentVpnIp(): Promise<string> {
  const used = new Set<string>(readIppEntries().values());
  try {
    const routersRes = await fetch(
      `${SUPABASE_URL}/rest/v1/isp_routers?select=vpn_ip&vpn_ip=not.is.null`,
      { headers: sbHeaders(BEST_KEY) },
    );
    if (routersRes.ok) {
      const rows = await routersRes.json() as Array<{ vpn_ip?: string | null }>;
      for (const row of rows) if (isRouterVpnIp(row.vpn_ip)) used.add(row.vpn_ip!.trim());
    }
  } catch {
    /* Continue with the local ipp snapshot; the unique index protects the
       final database write when several installers start together. */
  }
  return allocateRouterVpnIp(used);
}

router.post("/admin/router/ensure", requireAdmin(), async (req, res): Promise<void> => {
  if (!SUPABASE_URL || !BEST_KEY) {
    res.status(503).json({ ok: false, error: "Supabase not configured on this server (missing VITE_SUPABASE_URL or VITE_SUPABASE_KEY)" });
    return;
  }

  const { adminId: requestedAdminId, routerName, bridgeIp, bridgeInterface } = req.body as {
    adminId?: number;
    routerName?: string;
    bridgeIp?: string;
    bridgeInterface?: string;
  };

  const adminId = authenticatedAdminId(req, requestedAdminId);
  if (!adminId) {
    res.status(400).json({ ok: false, error: "A valid signed-in ISP account is required" });
    return;
  }

  let name = typeof routerName === "string" ? routerName.trim() : "";
  if (!name) {
    try {
      name = await nextCompanyRouterName(adminId, req.get("host") ?? "");
    } catch (error) {
      res.status(503).json({
        ok: false,
        error: `Could not choose a company router name: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
  }

  /* ── 1. Try to find an existing router with this name ── */
  try {
    const existRes = await fetch(
      `${SUPABASE_URL}/rest/v1/isp_routers?admin_id=eq.${adminId}&name=eq.${encodeURIComponent(name)}&select=*&limit=1`,
      { headers: sbHeaders(BEST_KEY) }
    );
    if (existRes.ok) {
      const rows = await existRes.json() as Record<string, unknown>[];
      if (rows.length > 0) {
        const existing = rows[0];
        if (!isRouterVpnIp(String(existing.vpn_ip ?? ""))) {
          try {
            const vpnIp = await allocatePersistentVpnIp();
            const updateRes = await fetch(
              `${SUPABASE_URL}/rest/v1/isp_routers?id=eq.${existing.id}`,
              {
                method: "PATCH",
                headers: sbHeaders(BEST_KEY),
                body: JSON.stringify({ vpn_ip: vpnIp }),
              },
            );
            if (updateRes.ok) existing.vpn_ip = vpnIp;
          } catch (error) {
            console.warn("[router/ensure] persistent VPN IP allocation deferred:", error);
          }
        }
        res.json({ ok: true, router: publicRouter(existing), created: false });
        return;
      }
    }
  } catch (e) {
    console.error("[router/ensure] SELECT failed:", e);
  }

  /* ── 2. Try INSERT (service-role key first, then anon key) ── */
  const keysToTry = SERVICE_KEY ? [SERVICE_KEY, ANON_KEY].filter(Boolean) : [ANON_KEY];
  const secret = makeSecret(adminId);
  let vpnIp = "";
  try {
    vpnIp = await allocatePersistentVpnIp();
  } catch (error) {
    console.warn("[router/ensure] persistent VPN IP allocation unavailable:", error);
  }
  const payload = {
    admin_id:         adminId,
    name,
    host:             "",
    router_username:  name,
    router_secret:    name,
    token:            secret,   /* NOT NULL installer token — kept separate from API password */
    bridge_interface: bridgeInterface || "bridge",
    bridge_ip:        bridgeIp        || "192.168.88.1",
    ...(vpnIp ? { vpn_ip: vpnIp } : {}),
    status:           "setup",
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
          res.json({ ok: true, router: publicRouter(rows[0]), created: true });
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
            res.json({ ok: true, router: publicRouter(rows2[0]), created: false });
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
