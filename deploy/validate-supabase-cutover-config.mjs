const expectedRef = "vuvyweofsutgqdtbjckj";
const requiredNames = [
  "SUPABASE_DEST_URL",
  "SUPABASE_DEST_PUBLISHABLE_KEY",
  "SUPABASE_DEST_SERVICE_ROLE_KEY",
  "SUPABASE_DEST_DB_URL",
];

const missing = requiredNames.filter(name => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Supabase cutover configuration is incomplete; missing: ${missing.join(", ")}.`);
  process.exit(1);
}

let apiTargetMatches = false;
let databaseTargetMatches = false;
try {
  const apiUrl = new URL(process.env.SUPABASE_DEST_URL);
  apiTargetMatches =
    apiUrl.protocol === "https:" &&
    apiUrl.hostname === `${expectedRef}.supabase.co`;

  const databaseUrl = new URL(process.env.SUPABASE_DEST_DB_URL);
  const databaseUsername = decodeURIComponent(databaseUrl.username);
  const hostnameRef = databaseUrl.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/i)?.[1]?.toLowerCase();
  const usernameRef = databaseUsername.match(/(?:^|\.)([a-z0-9]{20})$/i)?.[1]?.toLowerCase();
  databaseTargetMatches =
    ["postgres:", "postgresql:"].includes(databaseUrl.protocol) &&
    (hostnameRef === expectedRef || usernameRef === expectedRef);
} catch {
  apiTargetMatches = false;
  databaseTargetMatches = false;
}

if (!apiTargetMatches || !databaseTargetMatches) {
  console.error("Supabase destination identity validation failed; credential values were not displayed.");
  process.exit(1);
}

if (process.env.SUPABASE_DEST_SERVICE_ROLE_KEY === process.env.SUPABASE_DEST_PUBLISHABLE_KEY) {
  console.error("Supabase destination key-role validation failed; credential values were not displayed.");
  process.exit(1);
}

console.log("Supabase cutover configuration is present and matches the approved destination.");
