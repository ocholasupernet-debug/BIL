import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyEmployeeSignupReviewFailure,
  interpretEmployeeSignupReview,
} from "./employee-signup-review.js";

test("approval and rejection outcomes are recognized without exposing email fields", () => {
  assert.deepEqual(
    interpretEmployeeSignupReview({
      outcome: "approved",
      email: "staff@example.test",
      employee_id: "00000000-0000-4000-8000-000000000001",
    }),
    {
      kind: "approved",
      email: "staff@example.test",
      employeeId: "00000000-0000-4000-8000-000000000001",
    },
  );
  assert.deepEqual(
    interpretEmployeeSignupReview({ outcome: "rejected", email: "staff@example.test", employee_id: null }),
    { kind: "rejected", email: "staff@example.test", employeeId: null },
  );
});

test("duplicate and stale outcomes are distinct and safe to explain", () => {
  assert.deepEqual(
    interpretEmployeeSignupReview({ outcome: "duplicate", email: null, employee_id: null }),
    { kind: "duplicate" },
  );
  assert.deepEqual(
    interpretEmployeeSignupReview({ outcome: "invalid", email: null, employee_id: null }),
    { kind: "stale" },
  );
  assert.deepEqual(interpretEmployeeSignupReview(undefined), { kind: "unexpected" });
});

test("database failures map to actionable categories without returning raw details", () => {
  const cases: Array<[Error & { status?: number }, string]> = [
    [Object.assign(new Error("Supabase service-role access is required."), { status: 500 }), "configuration"],
    [Object.assign(new Error("42501 permission denied for function"), { status: 400 }), "permissions"],
    [Object.assign(new Error("PGRST202 function not in schema cache"), { status: 404 }), "schema"],
    [Object.assign(new Error("23505 duplicate key value"), { status: 409 }), "conflict"],
    [Object.assign(new Error("ETIMEDOUT connection timed out"), { status: 504 }), "uncertain"],
  ];

  for (const [error, category] of cases) {
    const failure = classifyEmployeeSignupReviewFailure(error);
    assert.equal(failure.category, category);
    assert.equal(failure.message.includes(error.message), false);
    assert.equal(failure.message.includes("staff@example.test"), false);
  }
});

test("unknown database details are not included in the response", () => {
  const failure = classifyEmployeeSignupReviewFailure(
    new Error("internal SQL detail includes staff@example.test and a private token"),
  );
  assert.equal(failure.category, "database");
  assert.match(failure.message, /Refresh the request list/);
  assert.doesNotMatch(failure.message, /staff@example\.test|private token|internal SQL detail/);
});
