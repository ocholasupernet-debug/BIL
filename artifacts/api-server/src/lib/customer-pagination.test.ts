import assert from "node:assert/strict";
import test from "node:test";
import { collectCustomerCursorPage } from "./customer-pagination.js";

test("customer pages filter archived rows and resume without skipping the batch remainder", async () => {
  const rows = [
    { id: 9, archived_at: null },
    { id: 8, archived_at: "2026-01-01" },
    { id: 7, archived_at: null },
    { id: 6, archived_at: null },
  ];
  const first = await collectCustomerCursorPage(
    async (beforeId) => rows.filter(row => beforeId === null || row.id < beforeId),
    { pageSize: 2, beforeId: null, includeArchived: false, batchSize: 4 },
  );
  assert.deepEqual(first.customers.map(row => row.id), [9, 7]);
  assert.equal(first.nextCursor, 7);
  assert.equal(first.hasMore, true);

  const second = await collectCustomerCursorPage(
    async beforeId => rows.filter(row => beforeId !== null && row.id < beforeId),
    { pageSize: 2, beforeId: first.nextCursor, includeArchived: false, batchSize: 4 },
  );
  assert.deepEqual(second.customers.map(row => row.id), [6]);
  assert.equal(second.nextCursor, null);
  assert.equal(second.hasMore, false);
});

test("customer cursor pagination rejects repeated or unordered IDs", async () => {
  await assert.rejects(
    collectCustomerCursorPage(
      async () => [{ id: 5 }, { id: 6 }],
      { pageSize: 2, beforeId: null, includeArchived: false, batchSize: 2 },
    ),
    /invalid or unordered cursor/,
  );
});
