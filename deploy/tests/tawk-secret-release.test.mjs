import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
const ecosystem = await readFile(new URL("../../ecosystem.config.cjs", import.meta.url), "utf8");

test("Tawk signing key is passed from GitHub Actions to the protected VPS environment without logging its value", () => {
  assert.match(workflow, /TAWK_API_KEY:\s*\$\{\{\s*secrets\.TAWK_API_KEY\s*\}\}/);
  assert.match(workflow, /envs:.*\bTAWK_API_KEY\b/);
  assert.match(workflow, /upsert_env "TAWK_API_KEY"\s+"\$TAWK_API_KEY"/);
  assert.match(ecosystem, /TAWK_API_KEY:\s*process\.env\.TAWK_API_KEY\s*\|\|\s*""/);
  assert.doesNotMatch(workflow, /echo\s+.*TAWK_API_KEY.*\$/);
});
