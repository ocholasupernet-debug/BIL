import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
const ecosystem = await readFile(new URL("../../ecosystem.config.cjs", import.meta.url), "utf8");

test("VPS release configures the canonical HTTPS BIL origin", () => {
  assert.match(workflow, /upsert_env "PUBLIC_APP_ORIGIN"\s+"https:\/\/isplatty\.com"/);
  assert.match(
    ecosystem,
    /PUBLIC_APP_ORIGIN:\s*process\.env\.PUBLIC_APP_ORIGIN\s*\|\|\s*"https:\/\/isplatty\.com"/,
  );
});
