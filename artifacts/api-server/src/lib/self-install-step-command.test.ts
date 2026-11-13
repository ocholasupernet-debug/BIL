import test from "node:test";
import assert from "node:assert/strict";
import { buildRouterFileImportCommand, buildSelfInstallStepCommand } from "./self-install-step-command.js";

test("RouterOS fetch/import command reports the exact failing stage and error", () => {
  const command = buildRouterFileImportCommand({
    sourceUrl: "https://come.isplatty.com/api/router-file-source/104/networksetup.rsc",
    fileName: "networksetup.rsc",
  });

  assert.equal(command.split("\n").length, 1);
  assert.match(command, /^:local ocholaStage "fetch"; :onerror fetchError in=\{/);
  assert.match(command, /\/tool fetch .*dst-path="networksetup\.rsc"/);
  assert.match(command, /\/import "networksetup\.rsc"/);
  assert.match(command, /\/file remove \[find where name="networksetup\.rsc"\]/);
  assert.match(command, /:set ocholaStage "fetch"/);
  assert.match(command, /:set ocholaStage "import"/);
  assert.match(command, /:set ocholaStage "cleanup"/);
  assert.match(command, /\[OCHOLA\] " \. \$ocholaStage \. " failed: " \. \$fetchError/);
  assert.doesNotMatch(command, /\$error\b/);
  assert.ok(command.indexOf('/import "networksetup.rsc"') < command.indexOf("/file remove"));
});

test("Self Install bundle command fetches its protected tenant URL before importing", () => {
  const command = buildRouterFileImportCommand({
    sourceUrl: "https://tenant.isplatty.com/api/router-file-source/one-time-token",
    fileName: "mainhotspot.rsc",
    verified: true,
  });

  assert.match(command, /url="https:\/\/tenant\.isplatty\.com\/api\/router-file-source\/one-time-token"/);
  assert.match(command, /dst-path="mainhotspot\.rsc" mode=https check-certificate=yes/);
  assert.match(command, /:onerror fetchError in=/);
  assert.ok(command.indexOf("/tool fetch") < command.indexOf('/import "mainhotspot.rsc"'));
  assert.ok(command.indexOf('/import "mainhotspot.rsc"') < command.indexOf("/file remove"));
});

test("Self Install commands report all step states and skip completed steps", () => {
  const command = buildSelfInstallStepCommand({
    routerId: 104,
    stepId: "services",
    stepOrder: 3,
    sourceUrl: "https://come.isplatty.com/api/router-file-source/104/servicessetup.rsc",
    fileName: "servicessetup.rsc",
    verified: true,
  });

  assert.match(command, /Step 1\/3 \(network engine\): COMPLETED/);
  assert.match(command, /Step 2\/3 \(management VPN\/API\): FAILED \(will retry\)/);
  assert.match(command, /Step 3\/3 \(Hotspot and PPPoE services\): PENDING/);
  assert.match(command, /find where name="ochola-self-install-104-step-3-done\.txt"/);
  assert.match(command, /Step 3\/3 SKIPPED - already completed/);
  assert.match(command, /check-certificate=yes/);
  assert.match(command, /:onerror ocholaCaughtError in=\{/);
  assert.match(command, /\[\" \. \$ocholaStepStage \. \"\] \" \. \$ocholaCaughtError/);
  assert.doesNotMatch(command, /\$error\b/);
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
  assert.match(command, /:onerror ocholaCaughtError in=\{/);
  assert.match(command, /:set ocholaStepStage \"import\"/);
  assert.doesNotMatch(command, /\$error\b/);
});