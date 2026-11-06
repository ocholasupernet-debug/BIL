import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routerRoute = await readFile("src/routes/mikrotik-route.ts", "utf8");
const routerScripts = await readFile("src/lib/mikrotik.ts", "utf8");
const selfInstallPage = await readFile(
  "../ochola-supernet/src/pages/admin/network/SelfInstall.tsx",
  "utf8",
);

test("v2 planning support leaves the existing three-step Self Install paths intact", () => {
  assert.match(routerRoute, /\["networksetup\.rsc", "vpnsetup\.rsc", "servicessetup\.rsc"\]/);
  assert.match(routerRoute, /\["brownfield-network\.rsc", "brownfield-vpn\.rsc", "brownfield-services\.rsc"\]/);
  assert.match(routerRoute, /router\.get\("\/router\/:id\/self-install-script", requireAdmin\(\)/);
  assert.match(selfInstallPage, /\/api\/router\/\$\{router\.id\}\/self-install-script/);
});

test("existing service generator retains its current addresses and login methods", () => {
  assert.match(routerScripts, /const hotspotGateway = "192\.168\.180\.1"/);
  assert.match(routerScripts, /const hotspotNetwork = "192\.168\.180\.0\/22"/);
  assert.match(routerScripts, /const hotspotPoolRange = "192\.168\.180\.10-192\.168\.183\.254"/);
  assert.match(routerScripts, /const pppoeGateway = "192\.168\.99\.1"/);
  assert.match(routerScripts, /login-by=http-chap,http-pap,cookie/);
});

test("existing Self Install still rejects the retired Takeover mode", () => {
  assert.match(routerRoute, /if \(\["takeover", "zero-touch", "zero_touch", "ztp_takeover", "router-takeover"\]\.includes\(requestedMode\)\)/);
  assert.match(routerRoute, /res\.status\(410\)\.json/);
});
