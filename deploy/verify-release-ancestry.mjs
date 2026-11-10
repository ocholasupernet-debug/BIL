const API_BASE = "https://api.github.com";
const MAX_RUN_PAGES = 5;

export async function verifyReleaseAncestry({
  repository,
  candidateSha,
  token,
  workflowFile = "deploy.yml",
  currentRunId,
  fetchImpl = globalThis.fetch,
}) {
  if (!repository || !candidateSha || !token || !currentRunId) {
    throw new Error("Release ancestry guard is missing GitHub workflow context.");
  }

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  let previousSuccess = null;
  let historyExhausted = false;
  for (let page = 1; page <= MAX_RUN_PAGES; page += 1) {
    const workflowPath = workflowFile.startsWith(".github/workflows/")
      ? workflowFile
      : `.github/workflows/${workflowFile}`;
    const runsUrl = new URL(`${API_BASE}/repos/${repository}/actions/runs`);
    runsUrl.searchParams.set("status", "completed");
    runsUrl.searchParams.set("per_page", "100");
    runsUrl.searchParams.set("page", String(page));

    const runsResponse = await fetchImpl(runsUrl, { headers });
    if (!runsResponse.ok) {
      throw new Error(`Could not check previous VPS releases (GitHub returned ${runsResponse.status}).`);
    }

    const runsData = await runsResponse.json();
    previousSuccess = (runsData.workflow_runs ?? []).find((run) =>
      String(run.id) !== String(currentRunId)
      && run.path === workflowPath
      && run.conclusion === "success"
      && typeof run.head_sha === "string"
      && /^[a-f0-9]{40}$/i.test(run.head_sha)
    ) ?? null;
    if (previousSuccess) break;
    if ((runsData.workflow_runs ?? []).length < 100) {
      historyExhausted = true;
      break;
    }
  }

  if (!previousSuccess) {
    if (!historyExhausted) {
      throw new Error("Could not find the last successful VPS release in recent GitHub history.");
    }
    return { firstSuccessfulRelease: true, previousSha: null };
  }

  const compareUrl = new URL(
    `${API_BASE}/repos/${repository}/compare/${previousSuccess.head_sha}...${candidateSha}`,
  );
  const compareResponse = await fetchImpl(compareUrl, { headers });
  if (!compareResponse.ok) {
    throw new Error(`Could not compare this release with the last successful VPS release (GitHub returned ${compareResponse.status}).`);
  }

  const comparison = await compareResponse.json();
  const isForwardOrSame =
    (comparison.status === "ahead" || comparison.status === "identical")
    && Number(comparison.behind_by) === 0;

  if (!isForwardOrSame) {
    throw new Error(
      `Refusing stale VPS release: ${candidateSha.slice(0, 12)} does not include the latest successful release ${previousSuccess.head_sha.slice(0, 12)}. Deploy from the latest release or a descendant.`,
    );
  }

  return {
    firstSuccessfulRelease: false,
    previousSha: previousSuccess.head_sha,
    comparisonStatus: comparison.status,
    aheadBy: Number(comparison.ahead_by) || 0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await verifyReleaseAncestry({
      repository: process.env.GITHUB_REPOSITORY,
      candidateSha: process.env.GITHUB_SHA,
      token: process.env.DEPLOY_GUARD_TOKEN,
      currentRunId: process.env.GITHUB_RUN_ID,
    });
    if (result.firstSuccessfulRelease) {
      console.log("No previous successful VPS release; allowing the initial deployment.");
    } else {
      console.log(
        `Release source guard passed: candidate is ${result.comparisonStatus} from the last successful VPS release.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Release ancestry guard failed.");
    process.exitCode = 1;
  }
}
