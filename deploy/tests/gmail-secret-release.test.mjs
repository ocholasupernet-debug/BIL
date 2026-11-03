import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
const ecosystem = await readFile(new URL("../../ecosystem.config.cjs", import.meta.url), "utf8");

test("Gmail App Password reaches PM2 environments without logging its value", () => {
  assert.match(workflow, /DEPLOY_GMAIL_APP_PASSWORD:\s*\$\{\{\s*secrets\.GMAIL_APP_PASSWORD\s*\}\}/);
  assert.match(workflow, /GMAIL_APP_PASSWORD_B64:\s*\$\{\{\s*steps\.encode_runtime_ssh\.outputs\.GMAIL_APP_PASSWORD_B64\s*\}\}/);
  assert.match(workflow, /envs:.*\bGMAIL_APP_PASSWORD_B64\b/);
  assert.match(workflow, /upsert_env "GMAIL_APP_PASSWORD"\s+"\$GMAIL_APP_PASSWORD"/);
  assert.equal(
    (ecosystem.match(/GMAIL_APP_PASSWORD:\s*process\.env\.GMAIL_APP_PASSWORD\s*\|\|\s*""/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(workflow, /echo\s+.*GMAIL_APP_PASSWORD.*\$/);
});
