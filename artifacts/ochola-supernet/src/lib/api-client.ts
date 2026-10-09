import { getAdminApiToken } from "@/lib/supabase";

const API_BASE = String(import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

function withHeaders(init: RequestInit, values: Record<string, string>): RequestInit {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(values)) {
    if (value && !headers.has(key)) headers.set(key, value);
  }
  return { ...init, headers };
}

export function apiUrl(path: string): string {
  if (!API_BASE) return path;
  if (API_BASE.endsWith("/api") && path.startsWith("/api/")) {
    return `${API_BASE}${path.slice("/api".length)}`;
  }
  return `${API_BASE}${path}`;
}

/** Authenticated tenant API call. Never send browser Supabase credentials for table access. */
export async function adminApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getAdminApiToken();
  return fetch(apiUrl(path), withHeaders(init, {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
  }));
}

/** Authenticated Super Admin API call. */
export async function superAdminApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = "";
  try { token = localStorage.getItem("ochola_superadmin_token") || ""; } catch { /* unavailable */ }
  return fetch(apiUrl(path), withHeaders(init, {
    ...(token ? { "x-sa-token": token } : {}),
    ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
  }));
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const responseText = await response.text();
  try {
    return JSON.parse(responseText) as T;
  } catch {
    const preview = responseText.replace(/\s+/g, " ").trim().slice(0, 120);
    throw new Error(
      `API returned non-JSON data (HTTP ${response.status}).`
      + (preview ? ` Response: ${preview}` : ""),
    );
  }
}