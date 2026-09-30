import assert from "node:assert/strict";
import test from "node:test";
import {
  processDeferredMpesaCallbacks,
  type DeferredMpesaCallbackDependencies,
  type DeferredMpesaCallbackEvent,
} from "./mpesa-route.js";

const NOW = Date.parse("2026-04-10T12:00:00.000Z");
type TestEvent = Omit<DeferredMpesaCallbackEvent, "payload"> & { payload: string; status: string };

function harness(initial: TestEvent[]) {
  const rows = initial.map(row => ({ ...row }));
  const queries: string[] = [];
  const processedPayloads: unknown[] = [];
  const dependencies: DeferredMpesaCallbackDependencies = {
    now: () => NOW,
    purgeTerminal: async () => undefined,
    select: async filter => {
      queries.push(filter);
      const params = new URLSearchParams(filter);
      let selected = rows.filter(row =>
        row.status === "received"
        && params.get("gateway") === "eq.mpesa"
        && params.get("status") === "eq.received"
        && (!params.has("reference") || params.get("reference") === `eq.${row.payload}`),
      );
      const createdAtGte = params.getAll("created_at").find(value => value.startsWith("gte."));
      const createdAtLt = params.getAll("created_at").find(value => value.startsWith("lt."));
      if (createdAtGte) selected = selected.filter(row => row.created_at >= createdAtGte.slice(4));
      if (createdAtLt) selected = selected.filter(row => row.created_at < createdAtLt.slice(3));
      const idGt = params.get("id");
      if (idGt?.startsWith("gt.")) selected = selected.filter(row => row.id > Number(idGt.slice(3)));
      const limit = Number(params.get("limit") ?? 100);
      selected.sort((a, b) => params.get("order") === "id.asc"
        ? a.id - b.id
        : a.created_at.localeCompare(b.created_at));
      return selected.slice(0, limit).map(({ id, payload, created_at }) => ({ id, payload, created_at }));
    },
    update: async (filter, values) => {
      const id = Number(new URLSearchParams(filter).get("id")?.slice(3));
      const row = rows.find(candidate => candidate.id === id && candidate.status === "received");
      if (row) row.status = values.status;
    },
    processCallback: async payload => {
      processedPayloads.push(payload);
      return true;
    },
  };
  return { rows, queries, processedPayloads, dependencies };
}

test("the periodic retry recovers a callback received during a 15-minute outage", async () => {
  const oldCallback = {
    id: 900001,
    payload: "outage-checkout",
    created_at: new Date(NOW - 15 * 60_000).toISOString(),
    status: "received",
  };
  const testHarness = harness([oldCallback]);

  await processDeferredMpesaCallbacks(undefined, testHarness.dependencies);

  assert.deepEqual(testHarness.processedPayloads, ["outage-checkout"]);
  assert.equal(testHarness.rows[0].status, "processed");
  assert.ok(testHarness.queries.some(query =>
    query.includes("created_at=gte.") && query.includes("created_at=lt."),
  ), "the retry scan includes callbacks older than the former 10-minute cutoff");
});

test("old failures cannot starve fresh callbacks and every scan stays bounded", async () => {
  const oldFailures = Array.from({ length: 51 }, (_, index) => ({
    id: 910000 + index,
    payload: `old-${index}`,
    created_at: new Date(NOW - 15 * 60_000 - index).toISOString(),
    status: "received",
  }));
  const fresh = {
    id: 920000,
    payload: "fresh",
    created_at: new Date(NOW - 60_000).toISOString(),
    status: "received",
  };
  const testHarness = harness([...oldFailures, fresh]);
  testHarness.dependencies.processCallback = async payload => {
    testHarness.processedPayloads.push(payload);
    return payload === "fresh";
  };

  await processDeferredMpesaCallbacks(undefined, testHarness.dependencies);

  assert.ok(testHarness.processedPayloads.includes("fresh"));
  assert.equal(testHarness.rows.find(row => row.payload === "fresh")?.status, "processed");
  assert.ok(testHarness.queries.length <= 3);
  assert.ok(testHarness.queries.every(query => Number(new URLSearchParams(query).get("limit")) <= 50));
  assert.ok(testHarness.rows.filter(row => row.payload.startsWith("old-")).every(row => row.status === "received"));

  await processDeferredMpesaCallbacks(undefined, testHarness.dependencies);
  assert.ok(testHarness.processedPayloads.includes("old-50"), "the ID cursor advances past repeatedly failing earlier rows");
});

test("only received callbacks are retried; terminal rows remain excluded", async () => {
  const testHarness = harness([
    { id: 930001, payload: "retry", created_at: new Date(NOW - 15 * 60_000).toISOString(), status: "received" },
    { id: 930002, payload: "done", created_at: new Date(NOW - 15 * 60_000).toISOString(), status: "processed" },
    { id: 930003, payload: "expired-terminal", created_at: new Date(NOW - 30 * 60 * 60_000).toISOString(), status: "ignored" },
  ]);

  await processDeferredMpesaCallbacks(undefined, testHarness.dependencies);

  assert.deepEqual(testHarness.processedPayloads, ["retry"]);
  assert.equal(testHarness.rows[1].status, "processed");
  assert.equal(testHarness.rows[2].status, "ignored");
  assert.ok(testHarness.queries.every(query => query.includes("status=eq.received")));
});

test("expired received callbacks are ignored in bounded batches, including explicit checkout retries", async () => {
  const expired = Array.from({ length: 55 }, (_, index) => ({
    id: 940000 + index,
    payload: `expired-${index}`,
    created_at: new Date(NOW - 25 * 60 * 60_000 - index).toISOString(),
    status: "received",
  }));
  const testHarness = harness(expired);
  await processDeferredMpesaCallbacks(undefined, testHarness.dependencies);
  assert.equal(testHarness.rows.filter(row => row.status === "ignored").length, 50);
  assert.deepEqual(testHarness.processedPayloads, []);

  await processDeferredMpesaCallbacks(undefined, testHarness.dependencies);
  assert.equal(testHarness.rows.filter(row => row.status === "ignored").length, 55);

  const specificallyExpired = harness([{
    id: 950001,
    payload: "explicit-expired-checkout",
    created_at: new Date(NOW - 25 * 60 * 60_000).toISOString(),
    status: "received",
  }]);
  await processDeferredMpesaCallbacks("explicit-expired-checkout", specificallyExpired.dependencies);
  assert.equal(specificallyExpired.rows[0].status, "ignored");
  assert.deepEqual(specificallyExpired.processedPayloads, []);
});

test("repeated expiry-update failures do not pin the expiry scan to the same oldest rows", async () => {
  const testHarness = harness(Array.from({ length: 55 }, (_, index) => ({
    id: 970000 + index,
    payload: `expiry-failure-${index}`,
    created_at: new Date(NOW - 25 * 60 * 60_000 - index).toISOString(),
    status: "received",
  })));
  testHarness.dependencies.update = async (filter, values) => {
    const id = Number(new URLSearchParams(filter).get("id")?.slice(3));
    const row = testHarness.rows.find(candidate => candidate.id === id && candidate.status === "received");
    if (row && id >= 970050) row.status = values.status;
  };

  await processDeferredMpesaCallbacks(undefined, testHarness.dependencies);
  assert.equal(testHarness.rows.filter(row => row.status === "ignored").length, 0);

  await processDeferredMpesaCallbacks(undefined, testHarness.dependencies);
  assert.equal(testHarness.rows.filter(row => row.status === "ignored").length, 5);
  assert.ok(testHarness.rows.filter(row => row.status === "received").length === 50);
});

test("a callback remains received after router activation failure and retries later", async () => {
  const testHarness = harness([{
    id: 960001,
    payload: "router-failure-checkout",
    created_at: new Date(NOW - 15 * 60_000).toISOString(),
    status: "received",
  }]);
  let attempts = 0;
  testHarness.dependencies.processCallback = async () => ++attempts > 1;

  await processDeferredMpesaCallbacks(undefined, testHarness.dependencies);
  assert.equal(testHarness.rows[0].status, "received");

  await processDeferredMpesaCallbacks(undefined, testHarness.dependencies);
  assert.equal(attempts, 1, "the cursor wraps after reaching the end of the old-event range");

  await processDeferredMpesaCallbacks(undefined, testHarness.dependencies);
  assert.equal(attempts, 2);
  assert.equal(testHarness.rows[0].status, "processed");
});
