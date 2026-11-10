import assert from "node:assert/strict";
import test from "node:test";
import { verifyReleaseAncestry } from "../verify-release-ancestry.mjs";

const repo = "example-org/bil";
const previousSha = "a".repeat(40);
const candidateSha = "b".repeat(40);
const context = {
  repository: repo,
  candidateSha,
  token: "test-token",
  currentRunId: "200",
};

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; },
  };
}

function mockFetch(compare, runs = [{
  id: 100,
  path: ".github/workflows/deploy.yml",
  conclusion: "success",
  head_sha: previousSha,
}]) {
  return async (url) => {
    const value = String(url);
    if (value.includes("/actions/runs")) {
      return response({ workflow_runs: runs });
    }
    if (value.includes("/compare/")) return response(compare);
    throw new Error("Unexpected request in release guard test.");
  };
}

test("allows a candidate that descends from the last successful release", async () => {
  const result = await verifyReleaseAncestry({
    ...context,
    fetchImpl: mockFetch({ status: "ahead", ahead_by: 3, behind_by: 0 }),
  });
  assert.equal(result.previousSha, previousSha);
  assert.equal(result.comparisonStatus, "ahead");
});

test("allows an intentional redeploy of the exact successful source", async () => {
  const result = await verifyReleaseAncestry({
    ...context,
    fetchImpl: mockFetch({ status: "identical", ahead_by: 0, behind_by: 0 }),
  });
  assert.equal(result.comparisonStatus, "identical");
});

test("ignores successful runs from other workflows when selecting the release baseline", async () => {
  const result = await verifyReleaseAncestry({
    ...context,
    fetchImpl: mockFetch(
      { status: "ahead", ahead_by: 1, behind_by: 0 },
      [
        { id: 199, path: ".github/workflows/desktop-release.yml", conclusion: "success", head_sha: "c".repeat(40) },
        { id: 100, path: ".github/workflows/deploy.yml", conclusion: "success", head_sha: previousSha },
      ],
    ),
  });
  assert.equal(result.previousSha, previousSha);
});

test("blocks a candidate that is behind the last successful release", async () => {
  await assert.rejects(
    verifyReleaseAncestry({
      ...context,
      fetchImpl: mockFetch({ status: "behind", ahead_by: 0, behind_by: 2 }),
    }),
    /Refusing stale VPS release/,
  );
});

test("blocks a divergent candidate release", async () => {
  await assert.rejects(
    verifyReleaseAncestry({
      ...context,
      fetchImpl: mockFetch({ status: "diverged", ahead_by: 2, behind_by: 1 }),
    }),
    /Refusing stale VPS release/,
  );
});

test("allows the first deployment when no successful release exists", async () => {
  let compareRequested = false;
  const result = await verifyReleaseAncestry({
    ...context,
    fetchImpl: async () => {
      if (compareRequested) throw new Error("Compare should not be requested.");
      return response({ workflow_runs: [] });
    },
  });
  assert.equal(result.firstSuccessfulRelease, true);
});

test("fails closed if GitHub cannot confirm release history", async () => {
  await assert.rejects(
    verifyReleaseAncestry({
      ...context,
      fetchImpl: async () => response({}, 403),
    }),
    /Could not check previous VPS releases/,
  );
});

test("fails closed when release history is too large to find a baseline", async () => {
  await assert.rejects(
    verifyReleaseAncestry({
      ...context,
      fetchImpl: async () => response({
        workflow_runs: Array.from({ length: 100 }, (_, index) => ({
          id: 500 - index,
          conclusion: "failure",
          head_sha: previousSha,
        })),
      }),
    }),
    /Could not find the last successful VPS release/,
  );
});
