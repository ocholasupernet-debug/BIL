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
  assert.match(route, /requestedRouterName/);
  assert.match(route, /company subdomain followed by a number/);
  assert.doesNotMatch(route, /ispledger\.com|freeispradius|self-install|install-status|routerId|installerGrant/);
});

test("Add Router (Script) provides the staged router ports and sync flow", () => {
  assert.match(page, /<AdminLayout hiddenNavHrefs=\{\["\/admin\/network\/self-install"\]\}>/);
  assert.match(page, /Add Router \(Script\)/);
  assert.match(page, /scripts\/mainhotspot\.rsc/);
  assert.match(page, /dst-path=mainhotspot\.rsc mode=https; \/import mainhotspot\.rsc/);
  assert.match(page, /from\("isp_admins"\)/);
  assert.match(page, /Next — load router ports/);
  assert.match(page, /\/api\/admin\/router\/self-install\/ports/);
  assert.match(page, /hotspot-bridge/);
  assert.match(page, /Next — sync IP pools, users and plans/);
  assert.match(page, /\/api\/admin\/router\/sync-copy/);
  assert.match(page, /\/api\/admin\/router\/ensure/);
  assert.match(page, /Create profile &amp; generate command|Create profile & generate command/);
});

test("router profile creation resumes an unfinished company router", async () => {
  const ensureRoute = await readFile("src/routes/router-ensure-route.ts", "utf8");
  assert.match(ensureRoute, /status=in\.\(setup,awaiting_ports,awaiting_sync,awaiting_connection\)/);
  assert.match(ensureRoute, /unfinishedRouterName\(adminId\)/);
  assert.match(ensureRoute, /name = await unfinishedRouterName\(adminId\)/);
});

test("the public Main ISP path is tenant-scoped and Self Install uses its separate path", async () => {
  const scriptsRoute = await readFile("src/routes/scripts-route.ts", "utf8");
  const selfInstall = await readFile("../ochola-supernet/src/pages/admin/network/SelfInstall.tsx", "utf8");
  assert.match(scriptsRoute, /router\.get\("\/scripts\/mainhotspot\.rsc", \(req, res\)/);
  assert.match(scriptsRoute, /buildMainIspConfigurationRsc\(subdomain, requestedRouterName\)/);
  assert.match(scriptsRoute, /router\.get\("\/scripts\/self-install-mainhotspot\.rsc"/);
  assert.match(selfInstall, /api\/scripts\/self-install-mainhotspot\.rsc/);
});