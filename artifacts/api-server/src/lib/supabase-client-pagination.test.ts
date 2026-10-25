import assert from "node:assert/strict";
import test from "node:test";
import { collectIdOrderedPages } from "./supabase-client.js";

test("collectIdOrderedPages continues past full pages without skipping rows", async () => {
  const source = Array.from({ length: 5 }, (_, index) => ({ id: index + 1 }));
  const cursors: number[] = [];

  const rows = await collectIdOrderedPages(async (afterId, pageSize) => {
    cursors.push(afterId);
    return source.filter(row => row.id > afterId).slice(0, pageSize);
  }, 2);

  assert.deepEqual(rows.map(row => row.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(cursors, [0, 2, 4]);
});

test("collectIdOrderedPages rejects a page that does not advance its cursor", async () => {
  await assert.rejects(
    collectIdOrderedPages(async () => [{ id: 1 }, { id: 1 }], 2),
    /invalid or unordered ID/,
  );
});
