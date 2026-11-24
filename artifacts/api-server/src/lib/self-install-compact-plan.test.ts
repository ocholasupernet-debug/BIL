import assert from "node:assert/strict";
import test from "node:test";
import { buildCompactSelfInstallFiles } from "./self-install-compact-plan.js";

const sections = [
  { id: "network", tag: "Network", title: "Network setup", description: "Prepare network.", content: ":put \"network\"" },
  { id: "vpn", tag: "VPN", title: "Management VPN", description: "Set up management.", content: ":put \"vpn\"" },
  { id: "services", tag: "Services", title: "Hotspot and PPPoE", description: "Set up customer services.", content: ":put \"services\"" },
] as const;

test("compact Self Install creates three ordered, independent RouterOS files", () => {
  const files = buildCompactSelfInstallFiles([...sections]);
  assert.deepEqual(files.map(file => file.id), ["network", "vpn", "services"]);
  assert.deepEqual(files.map(file => file.order), [1, 2, 3]);
  assert.deepEqual(files.map(file => file.fileName), [
    "self-install-network.rsc",
    "self-install-vpn.rsc",
    "self-install-services.rsc",
  ]);
  assert.match(files[0].content, /1\/1 NETWORK/);
  assert.doesNotMatch(files[0].content, /"vpn"|"services"/);
  assert.match(files[1].content, /1\/1 VPN/);
  assert.match(files[2].content, /1\/1 SERVICES/);
});

test("compact Self Install rejects missing, out-of-order, or empty sections", () => {
  assert.throws(() => buildCompactSelfInstallFiles(sections.slice(0, 2)), /requires network, VPN, and services/);
  assert.throws(
    () => buildCompactSelfInstallFiles([
      sections[1],
      sections[0],
      sections[2],
    ]),
    /section 1 must be network/,
  );
  assert.throws(
    () => buildCompactSelfInstallFiles([
      sections[0],
      sections[1],
      { ...sections[2], content: "  " },
    ]),
    /section 3 must be services and non-empty/,
  );
});
