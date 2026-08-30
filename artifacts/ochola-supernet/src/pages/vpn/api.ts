import { getAdminApiToken, getAdminRole, getSelectedTenantId } from "@/lib/supabase";

const API = import.meta.env.VITE_API_BASE ?? "";

export function vpnFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAdminApiToken();
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const selectedTenantId = getSelectedTenantId();
  if (getAdminRole() === "superadmin" && selectedTenantId) {
    headers.set("X-Impersonated-Admin-Id", String(selectedTenantId));
  }
  return fetch(`${API}${path}`, { ...init, headers });
}

export async function downloadVpnFile(path: string, filename: string): Promise<void> {
  const response = await vpnFetch(path);
  if (!response.ok) throw new Error(await response.text());
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}