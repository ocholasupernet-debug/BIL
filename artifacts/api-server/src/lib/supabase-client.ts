/**
 * Server-side Supabase helper.
 * Uses the service-role key (bypasses RLS) when available,
 * falls back to the anon key. Never called from the browser.
 */

/* VITE_SUPABASE_URL is the Supabase REST API base URL (https://xxx.supabase.co).
   SUPABASE_URL (if set) is often the Postgres connection string or bare hostname —
   skip it and fall back to VITE_SUPABASE_URL. */
function resolveSupabaseUrl(): string {
  const raw = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  if (!raw) return "";
  /* Ensure it starts with https:// */
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `https://${raw}`;
}

const SUPABASE_URL = resolveSupabaseUrl();

const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY    = process.env.VITE_SUPABASE_KEY ?? "";
const BEST_KEY    = SERVICE_KEY || ANON_KEY;

export const supabaseConfigured = !!(SUPABASE_URL && BEST_KEY);

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey:          BEST_KEY,
    Authorization:   `Bearer ${BEST_KEY}`,
    "Content-Type":  "application/json",
    Accept:          "application/json",
    ...extra,
  };
}

function url(table: string, query = ""): string {
  return `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`;
}

/** SELECT rows. Returns [] if Supabase is not configured. */
export async function sbSelect<T>(
  table: string,
  query: string,
): Promise<T[]> {
  if (!supabaseConfigured) return [];
  const res = await fetch(url(table, query), { headers: headers() });
  if (!res.ok) return [];
  return res.json() as Promise<T[]>;
}

/** INSERT row(s). Returns the inserted rows. */
export async function sbInsert<T>(
  table: string,
  payload: Record<string, unknown> | Record<string, unknown>[],
): Promise<T[]> {
  if (!supabaseConfigured) return [];
  const res = await fetch(url(table), {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) return [];
  return res.json() as Promise<T[]>;
}

/** UPDATE rows matching `filterQuery`. Returns updated rows. */
export async function sbUpdate<T>(
  table: string,
  filterQuery: string,
  payload: Record<string, unknown>,
): Promise<T[]> {
  if (!supabaseConfigured) return [];
  const res = await fetch(url(table, filterQuery), {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) return [];
  return res.json() as Promise<T[]>;
}

/** DELETE rows matching `filterQuery`. Returns deleted rows. */
export async function sbDelete<T>(
  table: string,
  filterQuery: string,
): Promise<T[]> {
  if (!supabaseConfigured) return [];
  const res = await fetch(url(table, filterQuery), {
    method: "DELETE",
    headers: headers({ Prefer: "return=representation" }),
  });
  if (!res.ok) return [];
  return res.json() as Promise<T[]>;
}
