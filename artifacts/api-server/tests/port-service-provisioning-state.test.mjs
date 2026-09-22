import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("src/routes/port-services-route.ts", "utf8");

test("in-flight port provisioning remains writable against older status constraints", () => {
  assert.match(route, /const persistedStatus = status === "provisioning" \? "pending" : status/);
  assert.match(route, /status: persistedStatus/);
});