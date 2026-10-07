import assert from "node:assert/strict";
import test from "node:test";
import { deleteOwnedVouchers } from "./hotspot-vouchers-route.js";

function storage(
  owned: { code: string; redeemed_at: string | null }[],
  sessions: { username: string }[] = [],
) {
  const reads: { table: string; filter: string }[] = [];
  const deletes: { table: string; filter: string }[] = [];
  return {
    reads,
    deletes,
    dependencies: {
      async select<T>(table: string, filter: string): Promise<T[]> {
        reads.push({ table, filter });
        return (table === "isp_radius_vouchers" ? owned : sessions) as T[];
      },
      async delete<T>(table: string, filter: string): Promise<T[]> {
        deletes.push({ table, filter });
        return [];
      },
    },
  };
}

test("a claimed voucher without a RADIUS session cannot be deleted", async () => {
  const stub = storage([{ code: "CLAIMED", redeemed_at: "2026-10-07T12:00:00Z" }]);
  await assert.rejects(
    deleteOwnedVouchers(7, ["CLAIMED"], stub.dependencies),
    { name: "RedeemedVoucherMutationError" },
  );
  assert.equal(stub.deletes.length, 0);
  assert.match(stub.reads[0].filter, /admin_id=eq\.7/);
  assert.match(stub.reads[0].filter, /select=code,redeemed_at/);
  assert.equal(stub.reads.length, 1);
});

test("a mixed batch with a claimed voucher is rejected before deleting unused vouchers", async () => {
  const stub = storage([
    { code: "UNUSED", redeemed_at: null },
    { code: "CLAIMED", redeemed_at: "2026-10-07T12:00:00Z" },
  ]);
  await assert.rejects(
    deleteOwnedVouchers(7, ["UNUSED", "CLAIMED"], stub.dependencies),
    { name: "RedeemedVoucherMutationError" },
  );
  assert.equal(stub.deletes.length, 0);
});

test("a voucher with accounting history remains protected even without a saved claim", async () => {
  const stub = storage([{ code: "USED", redeemed_at: null }], [{ username: "USED" }]);
  await assert.rejects(
    deleteOwnedVouchers(7, ["USED"], stub.dependencies),
    { name: "RedeemedVoucherMutationError" },
  );
  assert.equal(stub.deletes.length, 0);
});

test("an unused owned voucher can still be deleted through the shared deletion function", async () => {
  const stub = storage([{ code: "UNUSED", redeemed_at: null }]);
  assert.equal(await deleteOwnedVouchers(7, ["unused"], stub.dependencies), 1);
  assert.deepEqual(stub.deletes.map(row => row.table), ["radcheck", "radusergroup", "isp_radius_vouchers"]);
  assert.match(stub.deletes[2].filter, /admin_id=eq\.7/);
});

test("an unowned voucher does not cause any access records to be deleted", async () => {
  const stub = storage([]);
  assert.equal(await deleteOwnedVouchers(7, ["UNOWNED"], stub.dependencies), 0);
  assert.equal(stub.deletes.length, 0);
});
