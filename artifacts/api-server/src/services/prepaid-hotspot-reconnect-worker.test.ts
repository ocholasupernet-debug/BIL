import assert from "node:assert/strict";
import test from "node:test";
import { selectDistinctReconnectCandidates } from "./prepaid-hotspot-reconnect-worker.js";

test("reconnect worker selects at most one account per known router at a time", () => {
  const candidates = [
    { id: 1, admin_id: 10, router_id: 4 },
    { id: 2, admin_id: 10, router_id: 4 },
    { id: 3, admin_id: 11, router_id: 5 },
    { id: 4, admin_id: 12, router_id: 6 },
    { id: 5, admin_id: 10, router_id: 7 },
  ];

  const result = selectDistinctReconnectCandidates(candidates);

  assert.deepEqual(result.selected.map(candidate => candidate.id), [1, 3, 4]);
  assert.deepEqual(result.remaining.map(candidate => candidate.id), [2, 5]);
});

test("reconnect worker serializes candidates whose router assignment is unknown", () => {
  const candidates = [
    { id: 1, admin_id: 10, router_id: null },
    { id: 2, admin_id: 10, router_id: null },
    { id: 3, admin_id: 11, router_id: 8 },
  ];

  const firstPass = selectDistinctReconnectCandidates(candidates);
  const nextPass = selectDistinctReconnectCandidates(firstPass.remaining);

  assert.deepEqual(firstPass.selected.map(candidate => candidate.id), [1, 3]);
  assert.deepEqual(nextPass.selected.map(candidate => candidate.id), [2]);
});
