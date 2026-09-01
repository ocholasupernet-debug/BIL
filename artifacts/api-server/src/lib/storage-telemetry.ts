import { Client } from "pg";
import { runVpsScript, vpsSshConfigured } from "./vps-ssh.js";

export type TelemetryStatus = "available" | "partial" | "unavailable";

export interface StorageTelemetry {
  source: string;
  status: TelemetryStatus;
  measurementKind: string;
  usedBytes: number | null;
  capacityBytes: number | null;
  freeBytes: number | null;
  measuredAt: string | null;
  error: string | null;
  details?: Record<string, unknown>;
}

interface BucketObject {
  name?: unknown;
  id?: unknown;
  size?: unknown;
  metadata?: Record<string, unknown> | null;
}

interface BucketReport {
  bucket: string;
  status: "available" | "unavailable";
  usedBytes: number | null;
  objectCount: number | null;
  measuredAt: string | null;
  error: string | null;
}

const STORAGE_REQUEST_TIMEOUT_MS = 15_000;
const STORAGE_PAGE_SIZE = 1_000;
const MAX_STORAGE_OBJECTS = 1_000_000;

function unavailable(source: string, measurementKind: string, error: string): StorageTelemetry {
  return {
    source,
    status: "unavailable",
    measurementKind,
    usedBytes: null,
    capacityBytes: null,
    freeBytes: null,
    measuredAt: null,
    error,
  };
}

function supabaseUrl(): string {
  const raw = process.env.VITE_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || "";
  if (!raw) return "";
  return raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
}

function supabaseServiceKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || process.env.SUPABASE_SERVICE_KEY?.trim()
    || "";
}

function safeByteValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export async function measureSupabaseDatabase(): Promise<StorageTelemetry> {
  const connectionString = process.env.SUPABASE_DB_URL?.trim() || process.env.SUPABASE_DATABASE_URL?.trim();
  if (!connectionString) {
    return unavailable("supabase_postgres", "database_physical_size", "SUPABASE_DB_URL is not configured.");
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
  });
  try {
    await client.connect();
    const result = await client.query<{ used_bytes: string }>(
      "select pg_database_size(current_database())::bigint as used_bytes",
    );
    const usedBytes = safeByteValue(result.rows[0]?.used_bytes);
    if (usedBytes === null) throw new Error("The database returned an invalid size.");
    return {
      source: "supabase_postgres",
      status: "available",
      measurementKind: "database_physical_size",
      usedBytes,
      capacityBytes: null,
      freeBytes: null,
      measuredAt: new Date().toISOString(),
      error: null,
    };
  } catch {
    return unavailable("supabase_postgres", "database_physical_size", "Supabase Postgres size is unavailable.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function storageFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Storage request failed with status ${response.status}.`);
  return response.json() as Promise<T>;
}

async function measureBucket(baseUrl: string, key: string, bucket: string): Promise<BucketReport> {
  const measuredAt = new Date().toISOString();
  try {
    let bytes = 0;
    let objectCount = 0;
    const prefixes = [""];
    const visitedPrefixes = new Set<string>();

    while (prefixes.length > 0) {
      const prefix = prefixes.shift()!;
      if (visitedPrefixes.has(prefix)) continue;
      visitedPrefixes.add(prefix);
      for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
        const items = await storageFetch<BucketObject[]>(
          `${baseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
            body: JSON.stringify({
              prefix,
              limit: STORAGE_PAGE_SIZE,
              offset,
              sortBy: { column: "name", order: "asc" },
            }),
          },
        );
        if (!Array.isArray(items)) throw new Error("Storage returned an invalid object list.");
        for (const item of items) {
          const name = typeof item.name === "string" ? item.name : "";
          const isFolder = !item.id && !item.metadata && name.length > 0;
          if (isFolder) {
            prefixes.push(`${prefix}${name.replace(/\/+$/, "")}/`);
            continue;
          }
          const size = safeByteValue(item.metadata?.size ?? item.size);
          if (size === null) throw new Error("Storage returned an object without a verified size.");
          bytes += size;
          objectCount += 1;
          if (objectCount > MAX_STORAGE_OBJECTS) throw new Error("Storage object count exceeds the telemetry safety limit.");
        }
        if (items.length < STORAGE_PAGE_SIZE) break;
      }
    }

    return { bucket, status: "available", usedBytes: bytes, objectCount, measuredAt, error: null };
  } catch {
    return { bucket, status: "unavailable", usedBytes: null, objectCount: null, measuredAt: null, error: "This Supabase Storage bucket could not be measured." };
  }
}

export async function measureSupabaseStorage(): Promise<StorageTelemetry> {
  const baseUrl = supabaseUrl();
  const key = supabaseServiceKey();
  if (!baseUrl || !key) {
    return unavailable("supabase_storage", "storage_object_bytes", "Supabase Storage requires the Supabase URL and service-role key.");
  }

  try {
    const bucketRows = await storageFetch<Array<{ id?: unknown; name?: unknown }>>(
      `${baseUrl}/storage/v1/bucket`,
      { headers: { Authorization: `Bearer ${key}`, apikey: key } },
    );
    const bucketNames = bucketRows
      .map(bucket => typeof bucket.name === "string" ? bucket.name : typeof bucket.id === "string" ? bucket.id : "")
      .filter(Boolean);
    const buckets = await Promise.all(bucketNames.map(bucket => measureBucket(baseUrl, key, bucket)));
    const available = buckets.filter(bucket => bucket.status === "available");
    const status: TelemetryStatus = available.length === buckets.length
      ? "available"
      : available.length > 0
        ? "partial"
        : "unavailable";
    return {
      source: "supabase_storage",
      status,
      measurementKind: "storage_object_bytes",
      usedBytes: status === "available" ? available.reduce((sum, bucket) => sum + (bucket.usedBytes ?? 0), 0) : null,
      capacityBytes: null,
      freeBytes: null,
      measuredAt: status === "unavailable" ? null : new Date().toISOString(),
      error: status === "partial"
        ? "Some Supabase Storage buckets could not be measured."
        : status === "unavailable" && buckets.length > 0
          ? "Supabase Storage buckets could not be measured."
          : null,
      details: { buckets },
    };
  } catch {
    return unavailable("supabase_storage", "storage_object_bytes", "Supabase Storage usage is unavailable.");
  }
}

export async function measureVpsDisk(): Promise<StorageTelemetry> {
  if (!vpsSshConfigured()) {
    return unavailable("vps_filesystem", "filesystem_df", "VPS SSH telemetry is not configured.");
  }
  const path = process.env.VPS_STORAGE_PATH?.trim() || "/";
  if (!/^\/[A-Za-z0-9._/-]*$/.test(path)) {
    return unavailable("vps_filesystem", "filesystem_df", "VPS_STORAGE_PATH must be an absolute safe filesystem path.");
  }
  const result = await runVpsScript(
    `set -eu\nLC_ALL=C df -B1 --output=size,used,avail -- ${path} | awk 'NR == 2 { print $1 " " $2 " " $3 }'`,
    { timeoutMs: STORAGE_REQUEST_TIMEOUT_MS },
  );
  if (!result.ok) {
    return unavailable("vps_filesystem", "filesystem_df", "VPS filesystem usage is unavailable.");
  }
  const values = result.stdout.trim().split(/\s+/).map(Number);
  const [capacityBytes, usedBytes, freeBytes] = values;
  if (values.length !== 3 || values.some(value => !Number.isSafeInteger(value) || value < 0)) {
    return unavailable("vps_filesystem", "filesystem_df", "VPS returned an invalid filesystem measurement.");
  }
  return {
    source: "vps_filesystem",
    status: "available",
    measurementKind: "filesystem_df",
    usedBytes,
    capacityBytes,
    freeBytes,
    measuredAt: new Date().toISOString(),
    error: null,
    details: { path },
  };
}