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
  assert.match(route, /__MANAGEMENT_INTERFACE_NAME__/);
  assert.match(route, /routerManagementClientInterfaceName/);
  assert.match(route, /check-certificate=yes/);
  assert.doesNotMatch(route, /check-certificate=no/);
  assert.match(route, /proxyserver\.isplatty\.org\/ipp\.php/);
  assert.match(route, /proxyvpn\.isplatty\.org\/ipp\.php/);
  assert.match(route, /Primary proxyserver report failed; trying proxyvpn backup/);
  assert.match(route, /INSTALLATION_STATUS=SUCCESS/);
  assert.match(route, /VPN_STATUS=CONNECTED/);
  assert.match(route, /VPN_IP=/);
  assert.match(route, /PROXY_STATUS=REGISTERED/);
  assert.match(route, /API_LOCKDOWN=ACTIVE/);
  assert.match(route, /DNS_SCHEDULER=ACTIVE/);
  assert.match(route, /name=\("failed-" \. \$dst\)/);
  assert.match(route, /management VPN client __MANAGEMENT_INTERFACE_NAME__ did not reach running=yes/);
  assert.match(route, /API lockdown allow rule was not installed/);
  assert.match(route, /DNS flush scheduler was not created/);
  assert.match(route, /requestedRouterName/);
  assert.match(route, /routerVpnBaseUrl/);
  assert.match(route, /company subdomain followed by a number/);
  assert.doesNotMatch(route, /ispledger\.com|freeispradius|self-install|install-status/);
});

test("standalone installer checks both management VPN address pools and cleans staged files", () => {
  assert.match(route, /\/interface ovpn-client find where name="__MANAGEMENT_INTERFACE_NAME__"/);
  assert.match(route, /10\.8\.5\./);
  assert.match(route, /dst-path=\$temp/);
  assert.match(route, /\/import \$temp/);
  assert.match(route, /failed-" \. \$dst/);
  assert.match(route, /trusted\] != true/);
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
  assert.match(page, /\/api\/admin\/router\/self-install\/grant/);
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
  assert.match(scriptsRoute, /router\.get\(\[\s*"\/scripts\/router-vpn\.rsc",\s*"\/scripts\/router-vpn-bootstrap/);
  assert.match(scriptsRoute, /verifyInstallerGrant\(grant, routerId\)/);
  assert.match(scriptsRoute, /scripts\/router-vpn(?:\.rsc|-bootstrap)/);
  assert.match(scriptsRoute, /buildMainIspConfigurationRsc\(subdomain, currentRouter\.name, routerVpnBaseUrl, currentRouter\.id\)/);
  assert.match(scriptsRoute, /router\.get\("\/scripts\/self-install-mainhotspot\.rsc"/);
  assert.match(selfInstall, /api\/scripts\/self-install-mainhotspot\.rsc/);
});