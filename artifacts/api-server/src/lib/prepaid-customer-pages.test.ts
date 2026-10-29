import assert from "node:assert/strict";
import test from "node:test";
import { collectIdPages } from "./prepaid-customer-pages.js";

test("collectIdPages keeps loading past the first database page", async () => {
  const records = Array.from({ length: 2501 }, (_, index) => ({ id: index + 10 }));
  const cursors: Array<number | null> = [];

  const result = await collectIdPages(async (lastId, pageSize) => {
    cursors.push(lastId);
    const eligible = records.filter(record => lastId === null || record.id > lastId);
    return eligible.slice(0, pageSize);
  }, 1000);

  assert.equal(result.length, 2501);
  assert.equal(result[0].id, 10);
  assert.equal(result.at(-1)?.id, 2510);
  assert.deepEqual(cursors, [null, 1009, 2009]);
});

test("collectIdPages rejects a non-advancing full page", async () => {
  await assert.rejects(
    collectIdPages(async () => Array.from({ length: 2 }, () => ({ id: 7 })), 2),
    /invalid ID cursor/,
  );
});
