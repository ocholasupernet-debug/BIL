import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HotspotLayoutManager, type HotspotLayoutManagerProps } from "./HotspotLayoutManager.js";

const props: HotspotLayoutManagerProps = {
  mode: "builder",
  layouts: [{
    id: "classic",
    name: "Classic",
    version: "legacy",
    description: "Warm, editorial welcome",
    availability: "available",
    isBuiltIn: true,
    canDuplicate: true,
    canArchive: false,
  }],
  selectedLayoutId: "classic",
  deployment: {
    routerName: "Router 1",
    hotspotName: "hotspot1",
    selectedLayout: "Classic",
    installedLayout: null,
    syncStatus: "not-deployed",
    lastSuccessfulSync: null,
  },
  history: [],
  state: { loading: false, error: null, busy: false },
  selectLayout: () => undefined,
  previewLayout: () => undefined,
  duplicateLayout: () => undefined,
  archiveLayout: () => undefined,
  restoreLayout: () => undefined,
};

test("builder layout gallery previews and selects without router controls", () => {
  const markup = renderToStaticMarkup(<HotspotLayoutManager {...props} />);
  assert.match(markup, /Choose a page layout/);
  assert.match(markup, /does not change any router/);
  assert.match(markup, /Selected/);
  assert.doesNotMatch(markup, /Deploy layout|Router deployment|Deployment history|Deployment target/);
});

test("deployment mode preserves the existing router deployment controls", () => {
  const markup = renderToStaticMarkup(
    <HotspotLayoutManager {...props} mode="deployment" confirmDeploy={() => undefined} />,
  );
  assert.match(markup, /Hotspot layout manager/);
  assert.match(markup, /Deploy layout/);
  assert.match(markup, /Router deployment/);
  assert.match(markup, /Deployment history/);
});
