import test from "node:test";
import assert from "node:assert/strict";

process.env.VITE_SUPABASE_URL = "https://radius-strict-test.invalid";
process.env.VITE_SUPABASE_KEY = "radius-strict-test-key";

const {
  assertRadiusTargetEmptyStrict,
  hasRadiusCustomerStrict,
  moveRadiusCustomerStrict,
  removeRadiusCustomerStrict,
  rollbackRadiusCustomerMoveStrict,
  syncRadiusCustomerStrict,
} = await import("./radius.js");

type Row = Record<string, unknown> & { id: number };

test("strict RADIUS identity operations preflight, reconcile, remove, and roll back without accounting changes", async () => {
  const tables: Record<string, Row[]> = {
    radcheck: [
      { id: 1, username: "old-login", attribute: "Cleartext-Password", op: ":=", value: "pw" },
      { id: 6, username: "old-login", attribute: "Simultaneous-Use", op: ":=", value: "1" },
      { id: 7, username: "old-login", attribute: "Port-Limit", op: ":=", value: "1" },
    ],
    radusergroup: [{ id: 2, username: "old-login", groupname: "plan_7", priority: 1 }],
    radreply: [{ id: 3, username: "old-login", attribute: "Framed-Pool", op: ":=", value: "pool-a" }],
    radacct: [{ id: 4, username: "old-login", acctinputoctets: 123 }],
  };
  let failFirstRadreplyUpdate = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").pop()!;
    const rows = tables[table] ?? [];
    const method = init?.method ?? "GET";
    const matches = (row: Row) => [...url.searchParams.entries()]
      .filter(([key]) => key !== "select")
      .every(([key, filter]) => {
        const [operator, expected] = filter.split(".", 2);
        return operator === "eq" && String(row[key]) === expected;
      });
    let result: Row[] = [];
    if (method === "GET") {
      result = rows.filter(matches);
    } else if (method === "PATCH") {
      if (table === "radreply" && failFirstRadreplyUpdate) {
        failFirstRadreplyUpdate = false;
        return new Response(JSON.stringify({ message: "injected write failure" }), { status: 503 });
      }
      const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
      result = rows.filter(matches);
      for (const row of result) Object.assign(row, patch);
    } else if (method === "DELETE") {
      result = rows.filter(matches);
      tables[table] = rows.filter(row => !matches(row));
    } else {
      throw new Error(`Unexpected mocked Supabase method: ${method}`);
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    tables.radreply.push({ id: 5, username: "taken-login", attribute: "Other", op: ":=", value: "x" });
    await assert.rejects(
      moveRadiusCustomerStrict("old-login", "taken-login"),
      /already contains rows for the target username/,
    );
    assert.equal(tables.radcheck[0].username, "old-login");

    tables.radreply.pop();
    failFirstRadreplyUpdate = true;
    await assert.rejects(moveRadiusCustomerStrict("old-login", "new-login"));
    for (const table of ["radcheck", "radusergroup", "radreply"]) {
      assert.equal(tables[table].every(row => row.username === "old-login"), true);
    }

    await moveRadiusCustomerStrict("old-login", "new-login");
    for (const table of ["radcheck", "radusergroup", "radreply"]) {
      assert.equal(tables[table].some(row => row.username === "old-login"), false);
      assert.equal(tables[table].every(row => row.username === "new-login"), true);
    }
    assert.equal(tables.radacct[0].username, "old-login");

    await rollbackRadiusCustomerMoveStrict("new-login", "old-login");
    for (const table of ["radcheck", "radusergroup", "radreply"]) {
      assert.equal(tables[table].some(row => row.username === "new-login"), false);
      assert.equal(tables[table].every(row => row.username === "old-login"), true);
    }
    assert.equal(tables.radacct[0].acctinputoctets, 123);

    assert.equal(await hasRadiusCustomerStrict("old-login"), true);
    await assert.rejects(assertRadiusTargetEmptyStrict("old-login"), /already contains records/);
    await assertRadiusTargetEmptyStrict("unused-login");

    await syncRadiusCustomerStrict({
      username: "old-login",
      password: null,
      planId: 7,
      planType: "hotspot",
      enabled: true,
    });
    assert.equal(
      tables.radcheck.some(row => row.username === "old-login" && row.attribute === "Cleartext-Password"),
      false,
    );

    await removeRadiusCustomerStrict("old-login");
    assert.equal(await hasRadiusCustomerStrict("old-login"), false);
    assert.equal(tables.radacct[0].username, "old-login");
    assert.equal(tables.radacct[0].acctinputoctets, 123);
  } finally {
    globalThis.fetch = originalFetch;
  }
});