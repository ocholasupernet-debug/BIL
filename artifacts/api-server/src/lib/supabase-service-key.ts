export function getSupabaseServiceKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || env.SUPABASE_SERVICE_KEY?.trim()
    || "";
}
