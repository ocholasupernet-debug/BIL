import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");

test("VPS release configures the canonical HTTPS BIL origin", () => {
  assert.match(workflow, /upsert_env "PUBLIC_APP_ORIGIN"\s+"https:\/\/isplatty\.org"/);
});
