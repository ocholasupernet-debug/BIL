import assert from "node:assert/strict";
import test from "node:test";
import { resolveSupabaseUrl } from "./supabase-client.js";

test("explicit destination Supabase URL takes precedence over legacy URL settings", () => {
  assert.equal(resolveSupabaseUrl({
    SUPABASE_DEST_URL: " https://vuvyweofsutgqdtbjckj.supabase.co ",
    VITE_SUPABASE_URL: "https://legacy-project.supabase.co",
    SUPABASE_URL: "legacy-project.supabase.co",
  }), "https://vuvyweofsutgqdtbjckj.supabase.co");
});

test("blank destination URL falls back to the existing Vite URL", () => {
  assert.equal(resolveSupabaseUrl({
    SUPABASE_DEST_URL: " ",
    VITE_SUPABASE_URL: "https://legacy-project.supabase.co",
  }), "https://legacy-project.supabase.co");
});

test("database host fallback receives an HTTPS scheme", () => {
  assert.equal(resolveSupabaseUrl({ SUPABASE_URL: "db.example.supabase.co" }), "https://db.example.supabase.co");
});

test("missing URL configuration stays empty", () => {
  assert.equal(resolveSupabaseUrl({}), "");
});
