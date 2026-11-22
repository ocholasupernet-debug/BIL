const expectedProjectRef = "vuvyweofsutgqdtbjckj";
const configuredUrl = process.env.VITE_SUPABASE_URL;

if (!configuredUrl) {
  console.error("Supabase build target check failed: URL is missing.");
  process.exit(1);
}

let isExpectedTarget = false;
try {
  const url = new URL(configuredUrl);
  isExpectedTarget =
    url.protocol === "https:" &&
    url.hostname === `${expectedProjectRef}.supabase.co`;
} catch {
  isExpectedTarget = false;
}

if (!isExpectedTarget) {
  console.error(
    "Supabase build target check failed: configured URL does not match the approved destination; value not shown.",
  );
  process.exit(1);
}

console.log("Supabase build target check passed for the approved destination.");
