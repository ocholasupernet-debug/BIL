const expectedRef = "vuvyweofsutgqdtbjckj";

export async function verifySupabaseRuntimeTarget(env = process.env, fetchImpl = fetch) {
  const url = env.VITE_SUPABASE_URL?.trim() ?? "";
  const publishableKey = env.VITE_SUPABASE_KEY?.trim() ?? "";
  const serviceKey = env.SUPABASE_DEST_SERVICE_ROLE_KEY?.trim()
    || env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || "";

  if (!url || !publishableKey || !serviceKey) {
    return { ok: false, category: "missing_configuration" };
  }

  let origin;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== `${expectedRef}.supabase.co`) {
      return { ok: false, category: "target_mismatch" };
    }
    origin = parsed.origin;
  } catch {
    return { ok: false, category: "invalid_target" };
  }

  try {
    const authResponse = await fetchImpl(`${origin}/auth/v1/settings`, {
      headers: { apikey: publishableKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!authResponse.ok) {
      return {
        ok: false,
        category: authResponse.status === 401 || authResponse.status === 403
          ? "publishable_key_denied"
          : "auth_endpoint_failed",
        status: authResponse.status,
      };
    }

    const databaseResponse = await fetchImpl(`${origin}/rest/v1/isp_admins?select=id&limit=0`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!databaseResponse.ok) {
      return {
        ok: false,
        category: databaseResponse.status === 401 || databaseResponse.status === 403
          ? "service_role_denied"
          : "database_read_failed",
        status: databaseResponse.status,
      };
    }
    return { ok: true, category: "destination_read_ok" };
  } catch {
    return { ok: false, category: "network_error" };
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const result = await verifySupabaseRuntimeTarget();
  if (!result.ok) {
    console.error(
      `Supabase runtime verification failed: ${result.category}${result.status ? ` (HTTP ${result.status})` : ""}.`,
    );
    process.exit(1);
  }
  console.log("Supabase destination authentication and read-only database checks passed.");
}
