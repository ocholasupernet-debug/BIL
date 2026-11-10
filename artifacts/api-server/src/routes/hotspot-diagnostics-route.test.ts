import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { consumeRepairPreview } from "./hotspot-diagnostics-route.js";

test("repair previews are tenant/router/action scoped and one-time", () => {
  const token = "preview-token";
  const preview = {
    adminId: 7, routerId: 42, action: "enable-server" as const,
    target: "hs-main", value: "", expiresAt: 50_000,
  };
  const previews = new Map([[token, preview]]);
  assert.equal(consumeRepairPreview(previews, token, { adminId: 8, routerId: 42, action: "enable-server", target: "hs-main", value: "" }, 10_000), false);
  assert.equal(previews.has(token), false, "a wrong-tenant attempt must consume the preview");
  previews.set(token, preview);
  assert.equal(consumeRepairPreview(previews, token, { adminId: 7, routerId: 41, action: "enable-server", target: "hs-main", value: "" }, 10_000), false);
  previews.set(token, preview);
  assert.equal(consumeRepairPreview(previews, token, { adminId: 7, routerId: 42, action: "enable-server", target: "hs-main", value: "" }, 50_001), false, "expired preview cannot apply");
  previews.set(token, preview);
  assert.equal(consumeRepairPreview(previews, token, { adminId: 7, routerId: 42, action: "enable-server", target: "hs-main", value: "" }, 50_000), true);
  assert.equal(consumeRepairPreview(previews, token, { adminId: 7, routerId: 42, action: "enable-server", target: "hs-main", value: "" }, 50_000), false, "successful preview cannot be replayed");
});

test("diagnostic endpoint uses tenant-scoped credentials and read-only RouterOS commands", () => {
  const source = readFileSync(fileURLToPath(new URL("./hotspot-diagnostics-route.ts", import.meta.url)), "utf8");
  const scanRoute = source.slice(source.indexOf('router.get("/router/:id/hotspot-fix/diagnostics"'), source.indexOf('router.post("/router/:id/hotspot-fix/repair"'));
  assert.match(scanRoute, /requireAdmin\(\)/);
  assert.match(scanRoute, /getRouterCreds\(routerId, adminId\)/);
  assert.match(scanRoute, /runRouterCommands\(found\.creds, commands\)/);
  assert.match(scanRoute, /fetchRouterFiles\(found\.creds\)/);
  assert.doesNotMatch(scanRoute, /runRouterCommand\(found\.creds,\s*\[\s*"\/[^"]+\/(?:set|add|remove|enable|disable)/);
  assert.doesNotMatch(scanRoute, /deployRouterFile|\/hotspot-layouts\/deploy|\/interface\/pppoe-server/);
});

test("diagnostics keeps layout deployment and payment/customer repair out of automatic changes", () => {
  const source = readFileSync(fileURLToPath(new URL("./hotspot-diagnostics-route.ts", import.meta.url)), "utf8");
  assert.match(source, /const ALLOWED_REPAIRS = new Set/);
  assert.doesNotMatch(source, /"delete-user"|"repair-payment"|"sync-layout"/);
  assert.match(source, /isp_hotspot_layout_deployments/);
  assert.match(source, /hotspot_diagnostics_scan/);
  assert.match(source, /hotspot_repair_\$\{action\}/);
});
