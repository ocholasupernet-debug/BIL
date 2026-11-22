import test from "node:test";
import assert from "node:assert/strict";
import { getSupabaseServiceKey } from "./supabase-service-key.js";

test("prefers the explicit destination key over active and legacy aliases", () => {
  assert.equal(
    getSupabaseServiceKey({
      SUPABASE_DEST_SERVICE_ROLE_KEY: " destination-key ",
      SUPABASE_SERVICE_ROLE_KEY: " refreshed-key ",
      SUPABASE_SERVICE_KEY: "stale-key",
    } as NodeJS.ProcessEnv),
    "destination-key",
  );
});

test("falls back to the generic service-role key when the destination key is absent", () => {
  assert.equal(
    getSupabaseServiceKey({
      SUPABASE_DEST_SERVICE_ROLE_KEY: " ",
      SUPABASE_SERVICE_ROLE_KEY: "  ",
      SUPABASE_SERVICE_KEY: "legacy-key",
    } as NodeJS.ProcessEnv),
    "legacy-key",
  );
});
