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

/* Prefer the canonical name, but ignore empty legacy values so they cannot
   mask a valid service-role key from the deployment environment. */
const SERVICE_KEY = [
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  process.env.SUPABASE_SERVICE_KEY,
].find(value => !!value?.trim())?.trim() ?? "";
const ANON_KEY    = process.env.VITE_SUPABASE_KEY ?? "";
const BEST_KEY    = SERVICE_KEY || ANON_KEY;

export const supabaseConfigured = !!(SUPABASE_URL && BEST_KEY);
export const supabaseServiceRoleConfigured = !!(SUPABASE_URL && SERVICE_KEY);

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

/** SELECT rows and surface a safe failure to callers that require the schema. */
export async function sbSelectStrict<T>(
  table: string,
  query: string,
): Promise<T[]> {
  if (!supabaseConfigured) {
    throw new Error("Supabase is not configured.");
  }
  const res = await fetch(url(table, query), { headers: headers() });
  if (!res.ok) {
    throw new Error(`Supabase rejected the schema check (HTTP ${res.status}).`);
  }
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

/** INSERT or UPDATE rows using a unique conflict column. */
export async function sbUpsert<T>(
  table: string,
  conflictColumn: string,
  payload: Record<string, unknown>,
): Promise<T[]> {
  if (!supabaseConfigured) return [];
  const res = await fetch(url(table, `on_conflict=${encodeURIComponent(conflictColumn)}`), {
    method: "POST",
    headers: headers({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) return [];
  return res.json() as Promise<T[]>;
}

/** INSERT or UPDATE rows and surface a safe, actionable write failure to callers. */
export async function sbUpsertStrict<T>(
  table: string,
  conflictColumn: string,
  payload: Record<string, unknown>,
): Promise<T[]> {
  if (!supabaseConfigured) {
    throw new Error("Supabase is not configured for secure storage.");
  }
  const res = await fetch(url(table, `on_conflict=${encodeURIComponent(conflictColumn)}`), {
    method: "POST",
    headers: headers({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Supabase rejected the secure settings write (HTTP ${res.status}).`);
  }
  return res.json() as Promise<T[]>;
}

/** Invoke a Supabase RPC function using the server-only service role. */
export async function sbRpc<T>(
  functionName: string,
  payload: Record<string, unknown>,
): Promise<T[]> {
  if (!supabaseServiceRoleConfigured) {
    throw new Error("Supabase service-role access is required for this operation.");
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Supabase RPC ${functionName} failed: ${res.status}`);
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
