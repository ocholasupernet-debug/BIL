import { sbSelectStrict } from "./supabase-client.js";

/** Personalize only the default ISP login template, never reseller/VLAN exports. */
export async function prepareIspHotspotAsset(
  name: string,
  content: Buffer,
  scope: { adminId: number; routerId: number; apiBase: string },
  select: typeof sbSelectStrict = sbSelectStrict,
): Promise<Buffer> {
  if (name !== "login.html") return content;
  if (![scope.adminId, scope.routerId].every(id => Number.isSafeInteger(id) && id > 0)) {
    throw new Error("Hotspot login requires a valid ISP and router.");
  }
  const origin = new URL(scope.apiBase);
  if (origin.protocol !== "https:" || origin.username || origin.password
    || /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[::1\])$/i.test(origin.hostname)) {
    throw new Error("Hotspot login requires a public HTTPS API address.");
  }
  const html = content.toString("utf8");
  if (!/<\/head>/i.test(html) || html.includes("window.__HOTSPOT_CONFIG__=")) {
    throw new Error("Expected an unconfigured default Hotspot template.");
  }
  const plans = await select<Record<string, unknown>>(
    "isp_plans",
    `admin_id=eq.${scope.adminId}&router_id=eq.${scope.routerId}&port_id=is.null&owner_reseller_id=is.null&type=in.(hotspot,trials,trial)&is_active=is.true&client_can_purchase=is.true&select=id,name,price,validity,validity_unit&order=price.asc,name.asc`,
  );
  const config = JSON.stringify({
    adminId: scope.adminId, routerId: scope.routerId, portId: 0,
    apiBase: origin.origin, plans,
  }).replace(/</g, "\\u003c");
  return Buffer.from(html.replace(/<\/head>/i,
    () => `<script>window.__HOTSPOT_CONFIG__=${config};</script>\n</head>`));
}