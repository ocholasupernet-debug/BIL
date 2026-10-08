import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("database redemption uses whole KSh package price by default and keeps zero as an opt-out", async () => {
  const migration = await readFile(new URL("../../migrations/2026_hotspot_loyalty_points.sql", import.meta.url), "utf8");
  const runner = await readFile(new URL("../../scripts/apply-deployment-migrations.mjs", import.meta.url), "utf8");

  assert.match(migration, /select rule\.redemption_points into v_points_required[\s\S]+?if v_points_required is null then[\s\S]+?v_points_required := ceil\(v_plan\.price\)::integer;/);
  assert.match(migration, /if coalesce\(v_points_required, 0\) <= 0 then[\s\S]+?This plan is not enabled for loyalty redemption/);
  assert.match(runner, /2026_hotspot_loyalty_points\.sql/);
});
