import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Hotspot tethering plan policy is included in the deployment migration", async () => {
  const [migration, schema, runner] = await Promise.all([
    readFile(new URL("../../migrations/2026_hotspot_tethering_policy.sql", import.meta.url), "utf8"),
    readFile(new URL("../../migrations/supabase_schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /ADD COLUMN IF NOT EXISTS tethering_allowed boolean NOT NULL DEFAULT false/i);
  assert.match(schema, /tethering_allowed boolean not null default false/i);
  assert.match(runner, /2026_hotspot_tethering_policy\.sql/);
});
