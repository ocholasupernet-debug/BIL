/**
 * Server-side Supabase helper.
 * Uses the service-role key (bypasses RLS) when available,
 * falls back to the anon key. Never called from the browser.
 */
import {
  decryptRouterApiSecret,
  encryptRouterApiSecret,
  routerApiSecretLookupHash,
} from "./router-api-secret.js";

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

function normalizeSelectQuery(table: string, query = ""): string {
  let normalized = query;
  if (table === "isp_plans") {
    // isp_plans.type is the service type; data_limit_mb determines limited plans.
    // Older callers may still request the removed plan_type field.
    normalized = normalized.replace(/(^|&)select=([^&]*)/, (match, prefix: string, columns: string) => {
      const supportedColumns = columns.split(",").filter(column => column !== "plan_type");
      return supportedColumns.length > 0
        ? `${prefix}select=${supportedColumns.join(",")}`
        : match;
    });
  }
  if (table === "isp_routers") {
    normalized = normalized.replace(
      /router_secret(?:\.eq|=eq)\.([^&,)]+)/g,
      (_match, encodedSecret: string) => {
        let secret = encodedSecret;
        try { secret = decodeURIComponent(encodedSecret); } catch { /* already decoded */ }
        return `router_secret_lookup_hash.eq.${routerApiSecretLookupHash(decryptRouterApiSecret(secret))}`;
      },
    );
  }
  return normalized;
}

function url(table: string, query = ""): string {
  const normalizedQuery = normalizeSelectQuery(table, query);
  return `${SUPABASE_URL}/rest/v1/${table}${normalizedQuery ? `?${normalizedQuery}` : ""}`;
}

export class SupabaseHttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "SupabaseHttpError";
  }
}

function transformRouterSecretWrite(
  table: string,
  payload: Record<string, unknown> | Record<string, unknown>[],
): Record<string, unknown> | Record<string, unknown>[] {
  if (table !== "isp_routers") return payload;
  const transform = (row: Record<string, unknown>) => {
    if (typeof row.router_secret !== "string" || !row.router_secret) return row;
    const secret = decryptRouterApiSecret(row.router_secret);
    return {
      ...row,
      router_secret: encryptRouterApiSecret(secret),
      router_secret_lookup_hash: routerApiSecretLookupHash(secret),
    };
  };
  return Array.isArray(payload) ? payload.map(transform) : transform(payload);
}

async function responseRows<T>(res: Response, table: string): Promise<T[]> {
  const rows = await res.json() as Array<Record<string, unknown>>;
  if (table !== "isp_routers" || !Array.isArray(rows)) return rows as T[];
  return rows.map(row => {
    const result = { ...row };
    if (typeof result.router_secret === "string") {
      const stored = result.router_secret;
      const plaintext = decryptRouterApiSecret(result.router_secret);
      delete result.router_secret;
      Object.defineProperty(result, "router_secret", {
        value: plaintext,
        enumerable: false,
        configurable: false,
        writable: false,
      });
      Object.defineProperty(result, "toJSON", {
        value: () => ({
          ...row,
          router_secret: stored.startsWith("enc:v1:") ? stored : encryptRouterApiSecret(plaintext),
          router_secret_lookup_hash: undefined,
        }),
        enumerable: false,
      });
    }
    delete result.router_secret_lookup_hash;
    return result as T;
  });
}

async function supabaseFailure(res: Response, operation: string): Promise<SupabaseHttpError> {
  let detail = "";
  try {
    const body = await res.json() as {
      code?: unknown;
      message?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    detail = [body.code, body.message, body.details, body.hint]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map(value => value.trim().replace(/\s+/g, " "))
      .join(" — ")
      .slice(0, 600);
  } catch {
    // Keep the stable status-only error when Supabase does not return JSON.
  }
  return new SupabaseHttpError(`Supabase rejected ${operation} (HTTP ${res.status})${detail ? `: ${detail}` : "."}`, res.status);
}

/** SELECT rows. Returns [] if Supabase is not configured. */
export async function sbSelect<T>(
  table: string,
  query: string,
): Promise<T[]> {
  if (!supabaseConfigured) return [];
  const res = await fetch(url(table, query), { headers: headers() });
  if (!res.ok) return [];
  return responseRows<T>(res, table);
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
    throw await supabaseFailure(res, "the schema check");
  }
  return responseRows<T>(res, table);
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
    body: JSON.stringify(transformRouterSecretWrite(table, payload)),
  });
  if (!res.ok) return [];
  return responseRows<T>(res, table);
}

/** INSERT which never turns a persistence failure into a false success. */
export async function sbInsertStrict<T>(
  table: string,
  payload: Record<string, unknown> | Record<string, unknown>[],
): Promise<T[]> {
  if (!supabaseConfigured) throw new Error("Supabase is not configured for secure storage.");
  const res = await fetch(url(table), {
    method: "POST", headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(transformRouterSecretWrite(table, payload)),
  });
  if (!res.ok) throw await supabaseFailure(res, "the migration write");
  return responseRows<T>(res, table);
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
    body: JSON.stringify(transformRouterSecretWrite(table, payload)),
  });
  if (!res.ok) return [];
  return responseRows<T>(res, table);
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
    body: JSON.stringify(transformRouterSecretWrite(table, payload)),
  });
  if (!res.ok) {
    throw await supabaseFailure(res, "the secure settings write");
  }
  return responseRows<T>(res, table);
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
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json() as { code?: unknown; message?: unknown };
      detail = [body.code, body.message]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map(value => value.trim().replace(/\s+/g, " "))
        .join(" — ")
        .slice(0, 400);
    } catch {
      // Keep the status-only failure if Supabase did not return JSON.
    }
    throw new SupabaseHttpError(
      `Supabase RPC ${functionName} failed (HTTP ${res.status})${detail ? `: ${detail}` : "."}`,
      res.status,
    );
  }
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
    body: JSON.stringify(transformRouterSecretWrite(table, payload)),
  });
  if (!res.ok) return [];
  return responseRows<T>(res, table);
}

export async function sbUpdateStrict<T>(
  table: string, filterQuery: string, payload: Record<string, unknown>,
): Promise<T[]> {
  if (!supabaseConfigured) throw new Error("Supabase is not configured for secure storage.");
  const res = await fetch(url(table, filterQuery), {
    method: "PATCH", headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(transformRouterSecretWrite(table, payload)),
  });
  if (!res.ok) throw await supabaseFailure(res, "the migration write");
  return responseRows<T>(res, table);
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
  return responseRows<T>(res, table);
}

/** DELETE rows and surface persistence failures to provisioning callers. */
export async function sbDeleteStrict<T>(
  table: string,
  filterQuery: string,
): Promise<T[]> {
  if (!supabaseConfigured) throw new Error("Supabase is not configured for secure storage.");
  const res = await fetch(url(table, filterQuery), {
    method: "DELETE",
    headers: headers({ Prefer: "return=representation" }),
  });
  if (!res.ok) throw await supabaseFailure(res, `deletion from ${table}`);
  return responseRows<T>(res, table);
}
