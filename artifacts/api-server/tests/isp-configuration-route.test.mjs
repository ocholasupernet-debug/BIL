import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile("src/routes/isp-configuration-route.ts", "utf8");
const page = await readFile("../ochola-supernet/src/pages/admin/network/SelfProvision.tsx", "utf8");

test("standalone ISP configuration route serves only the supplied script family", () => {
  assert.match(route, /router\.get\("\/admin\/isp-configuration\/mainhotspot\.rsc", requireAdmin\(\)/);
  assert.match(route, /buildMainIspConfigurationRsc/);
  assert.match(route, /String\.raw`# OcholaSuperNet Main ISP Configuration Script/);
  assert.match(route, /https:\/\/bil\.isplatty\.org\/scripts\/vpn7\.rsc/);
  assert.match(route, /interface="ocholasupernet"/);
  assert.match(route, /proxyserver\.isplatty\.org\/ipp\.php/);
  assert.match(route, /proxyvpn\.isplatty\.org\/ipp\.php/);
  assert.match(route, /Primary proxyserver report failed; trying proxyvpn backup/);
  assert.doesNotMatch(route, /ispledger\.com|freeispradius|self-install|install-status|routerId|installerGrant/);
});

test("ISP configuration page does not use the Self Install controls", () => {
  assert.match(page, /<AdminLayout hiddenNavHrefs=\{\["\/admin\/network\/self-install"\]\}>/);
  assert.match(page, /Add Router \(Script\)/);
  assert.match(page, /scripts\/mainhotspot\.rsc/);
  assert.match(page, /dst-path=mainhotspot\.rsc mode=https; \/import mainhotspot\.rsc/);
  assert.match(page, /from\("isp_admins"\)/);
  assert.doesNotMatch(page, /Self Install|install-status|routerId|grantToken|vpnConnected/);
});

test("the public Main ISP path is tenant-scoped and Self Install uses its separate path", async () => {
  const scriptsRoute = await readFile("src/routes/scripts-route.ts", "utf8");
  const selfInstall = await readFile("../ochola-supernet/src/pages/admin/network/SelfInstall.tsx", "utf8");
  assert.match(scriptsRoute, /router\.get\("\/scripts\/mainhotspot\.rsc", \(req, res\)/);
  assert.match(scriptsRoute, /buildMainIspConfigurationRsc\(subdomain\)/);
  assert.match(scriptsRoute, /router\.get\("\/scripts\/self-install-mainhotspot\.rsc"/);
  assert.match(selfInstall, /api\/scripts\/self-install-mainhotspot\.rsc/);
});