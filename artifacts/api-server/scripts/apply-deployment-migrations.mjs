import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

function normalizeConnectionString(raw) {
  const schemeEnd = raw.indexOf("://");
  const userInfoStart = schemeEnd + 3;
  const passwordStart = raw.indexOf(":", userInfoStart);
  const hostStart = raw.lastIndexOf("@");
  if (schemeEnd < 0 || passwordStart < userInfoStart || hostStart < passwordStart) {
    throw new Error("SUPABASE_DB_URL is not a valid Postgres connection string.");
  }

  const decodeSafely = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const username = encodeURIComponent(decodeSafely(raw.slice(userInfoStart, passwordStart)));
  const password = encodeURIComponent(decodeSafely(raw.slice(passwordStart + 1, hostStart)));
  const normalized = `${raw.slice(0, userInfoStart)}${username}:${password}${raw.slice(hostStart)}`;
  const connectionUrl = new URL(normalized);
  connectionUrl.searchParams.set("uselibpqcompat", "true");
  connectionUrl.searchParams.set("sslmode", "require");
  return connectionUrl.toString();
}

const databaseUrl = process.env.SUPABASE_DB_URL || process.env.SUPABASE_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL is required.");
}

const migrationPaths = [
  fileURLToPath(new URL("../migrations/2026_admin_initial_password_setup.sql", import.meta.url)),
  fileURLToPath(new URL("../migrations/2026_secure_mpesa_callback_processing.sql", import.meta.url)),
];
const client = new Client({ connectionString: normalizeConnectionString(databaseUrl) });

try {
  await client.connect();
  for (const migrationPath of migrationPaths) {
    await client.query(await readFile(migrationPath, "utf8"));
  }
} finally {
  await client.end();
}