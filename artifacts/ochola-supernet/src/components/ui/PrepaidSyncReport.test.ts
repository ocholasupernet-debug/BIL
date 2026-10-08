import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { PrepaidSyncReport, type PrepaidSyncResult } from "./PrepaidSyncReport";

const synced: PrepaidSyncResult = {
  customerId: 1, username: "test-account", planName: "3 hours",
  serviceType: "hotspot", routerName: "Test router", outcome: "synced",
};
const props = {
  running: false, total: 1, processed: 1, users: [synced],
  routerName: "Test router", logs: [], onDismiss: () => {},
};
test("a confirmed completed report shows all requested account details", () => {
  const html = renderToStaticMarkup(createElement(PrepaidSyncReport, props));
  assert.match(html, /Fully synced/);
  for (const value of ["Username", "Plan", "Type", "Router", "Sync status", "test-account", "3 hours", "Test router", "Synced"]) {
    assert.ok(html.includes(value), value);
  }
});
test("running sync shows only one progress report, not partial result rows", () => {
  const html = renderToStaticMarkup(createElement(PrepaidSyncReport, { ...props, running: true }));
  assert.match(html, /role="progressbar"/);
  assert.doesNotMatch(html, /test-account/);
  assert.doesNotMatch(html, /Fully synced/);
});
test("failed, skipped, unknown, incomplete or errored results never claim fully synced", () => {
  for (const outcome of ["failed", "skipped", "unknown"] as const) {
    const html = renderToStaticMarkup(createElement(PrepaidSyncReport, { ...props, users: [{ ...synced, outcome }] }));
    assert.doesNotMatch(html, /Fully synced/);
  }
  for (const overrides of [{ processed: 0 }, { total: 2 }, { error: "Connection lost" }]) {
    assert.doesNotMatch(renderToStaticMarkup(createElement(PrepaidSyncReport, { ...props, ...overrides })), /Fully synced/);
  }
});
test("empty sync is explicit and technical logs remain collapsed", () => {
  const html = renderToStaticMarkup(createElement(PrepaidSyncReport, {
    ...props, total: 0, processed: 0, users: [], logs: ["Router detail"],
  }));
  assert.match(html, /No active accounts to sync/);
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
});
