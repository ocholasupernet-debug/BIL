import test from "node:test";
import assert from "node:assert/strict";
import { buildRouterFileImportCommand, buildSelfInstallStepCommand } from "./self-install-step-command.js";

test("RouterOS fetch/import command runs as one block and preserves the file on import failure", () => {
  const command = buildRouterFileImportCommand({
    sourceUrl: "https://come.isplatty.org/api/router-file-source/104/networksetup.rsc",
    fileName: "networksetup.rsc",
  });

  assert.equal(command.split("\n").length, 1);
  assert.match(command, /^:do \{/);
  assert.match(command, /\/tool fetch .*dst-path="networksetup\.rsc"/);
  assert.match(command, /\/import "networksetup\.rsc"/);
  assert.match(command, /\/file remove \[find where name="networksetup\.rsc"\]/);
  assert.match(command, /Import step failed: /);
  assert.ok(command.indexOf('/import "networksetup.rsc"') < command.indexOf("/file remove"));
});

test("Self Install commands report all step states and skip completed steps", () => {
  const command = buildSelfInstallStepCommand({
    routerId: 104,
    stepId: "services",
    stepOrder: 3,
    sourceUrl: "https://come.isplatty.org/api/router-file-source/104/servicessetup.rsc",
    fileName: "servicessetup.rsc",
    verified: true,
  });

  assert.match(command, /Step 1\/3 \(network engine\): COMPLETED/);
  assert.match(command, /Step 2\/3 \(management VPN\/API\): FAILED \(will retry\)/);
  assert.match(command, /Step 3\/3 \(Hotspot and PPPoE services\): PENDING/);
  assert.match(command, /find where name="ochola-self-install-104-step-3-done\.txt"/);
  assert.match(command, /Step 3\/3 SKIPPED - already completed/);
  assert.match(command, /check-certificate=yes/);
});

test("Self Install commands preserve failed downloads and write retry markers", () => {
  const command = buildSelfInstallStepCommand({
    routerId: 42,
    stepId: "vpn",
    stepOrder: 2,
    sourceUrl: "https://vpn.example.test/vpnsetup.rsc",
    fileName: "vpnsetup.rsc",
  });

  assert.match(command, /:put \("\[OCHOLA\] Step 2\/3 FAILED: " \. \$ocholaStepError\)/);
  assert.match(command, /downloaded vpnsetup\.rsc was preserved/);
  assert.match(command, /file print file="ochola-self-install-42-step-2-failed"/);
  assert.match(command, /file set \[find where name="ochola-self-install-42-step-2-failed\.txt"\] contents=/);
  assert.match(command, /file print file="ochola-self-install-42-step-2-done"/);
  assert.match(command, /Step 2\/3 COMPLETED successfully/);
  assert.match(command, /check-certificate=no/);
});