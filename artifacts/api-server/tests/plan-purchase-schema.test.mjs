import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("migrations/2026_plan_purchase_visibility.sql", "utf8");
const runner = await readFile("scripts/apply-deployment-migrations.mjs", "utf8");
const schema = await readFile("migrations/supabase_schema.sql", "utf8");

test("plan purchase visibility migration adds the column idempotently", () => {
  assert.match(migration, /alter table public\.isp_plans/);
  assert.match(migration, /add column if not exists client_can_purchase boolean not null default true/);
});

test("deployment runner applies plan purchase visibility before the API starts", () => {
  assert.match(runner, /2026_plan_purchase_visibility\.sql/);
});

test("base plan schema includes the customer purchase flag", () => {
  assert.match(schema, /client_can_purchase boolean not null default true/);
});