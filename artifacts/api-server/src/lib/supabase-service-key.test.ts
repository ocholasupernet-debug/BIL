import test from "node:test";
import assert from "node:assert/strict";
import { getSupabaseServiceKey } from "./supabase-service-key.js";

test("prefers the refreshed SUPABASE_SERVICE_ROLE_KEY over the legacy alias", () => {
  assert.equal(
    getSupabaseServiceKey({
      SUPABASE_SERVICE_ROLE_KEY: " refreshed-key ",
      SUPABASE_SERVICE_KEY: "stale-key",
    } as NodeJS.ProcessEnv),
    "refreshed-key",
  );
});

test("falls back to the legacy key only when the role key is absent", () => {
  assert.equal(
    getSupabaseServiceKey({
      SUPABASE_SERVICE_ROLE_KEY: "  ",
      SUPABASE_SERVICE_KEY: "legacy-key",
    } as NodeJS.ProcessEnv),
    "legacy-key",
  );
});
