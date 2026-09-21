const API_BASE = String(import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

export function apiUrl(path: string): string {
  if (!API_BASE) return path;
  if (API_BASE.endsWith("/api") && path.startsWith("/api/")) {
    return `${API_BASE}${path.slice("/api".length)}`;
  }
  return `${API_BASE}${path}`;
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const responseText = await response.text();
  try {
    return JSON.parse(responseText) as T;
  } catch {
    const preview = responseText.replace(/\s+/g, " ").trim().slice(0, 120);
    throw new Error(
      `API returned non-JSON data (HTTP ${response.status}).`
      + (preview ? ` Check the API address. Response: ${preview}` : ""),
    );
  }
}