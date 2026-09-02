import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("src/routes/isp-configuration-route.ts", "utf8");
const page = await readFile("../ochola-supernet/src/pages/admin/network/SelfProvision.tsx", "utf8");

test("standalone ISP configuration route serves only the supplied script family", () => {
  assert.match(route, /router\.get\("\/admin\/isp-configuration\/mainhotspot\.rsc", requireAdmin\(\)/);
  assert.match(route, /String\.raw`# OcholaSuperNet Main ISP Configuration Script/);
  assert.match(route, /https:\/\/bil\.isplatty\.org\/scripts\/vpn7\.rsc/);
  assert.match(route, /interface="ocholasupernet"/);
  assert.doesNotMatch(route, /ispledger\.com|freeispradius|self-install|install-status|routerId|installerGrant/);
});

test("ISP configuration page does not use the Self Install controls", () => {
  assert.match(page, /\/api\/admin\/isp-configuration\/mainhotspot\.rsc/);
  assert.match(page, /Generate configuration/);
  assert.doesNotMatch(page, /Self Install|self-install|install-status|routerId|grantToken|vpnConnected/);
});