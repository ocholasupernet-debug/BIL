import assert from "node:assert/strict";
import test from "node:test";
import { buildCompactSelfInstallBootstrap } from "./self-install-compact-bootstrap.js";

const stages = [
  {
    id: "network",
    fileName: "networksetup-250-a1b2c3d4.rsc",
    sourceUrl: "https://tenant.isplatty.com/api/router-file-source/network-token",
  },
  {
    id: "vpn",
    fileName: "vpnsetup-250-a1b2c3d4.rsc",
    sourceUrl: "https://tenant.isplatty.com/api/router-file-source/vpn-token",
  },
  {
    id: "services",
    fileName: "servicessetup-250-a1b2c3d4.rsc",
    sourceUrl: "https://tenant.isplatty.com/api/router-file-source/services-token",
  },
] as const;

test("compact bootstrap trusts HTTPS before fetching and imports stages in order", () => {
  const script = buildCompactSelfInstallBootstrap([...stages]);
  const trust = script.indexOf('/certificate set [find where common-name="ISRG Root X1"] trusted=yes');
  const network = script.indexOf('dst-path="networksetup-250-a1b2c3d4.rsc"');
  const vpn = script.indexOf('dst-path="vpnsetup-250-a1b2c3d4.rsc"');
  const services = script.indexOf('dst-path="servicessetup-250-a1b2c3d4.rsc"');

  assert.ok(trust >= 0);
  assert.ok(trust < network && network < vpn && vpn < services);
  assert.match(script, /check-certificate=yes/);
  assert.match(script, /\/import "networksetup-250-a1b2c3d4\.rsc"/);
  assert.match(script, /\/import "vpnsetup-250-a1b2c3d4\.rsc"/);
  assert.match(script, /\/import "servicessetup-250-a1b2c3d4\.rsc"/);
  assert.match(script, /stage failed; its file was kept for diagnosis/);
  assert.match(script, /Regenerate the bootstrap if its signed link expired/);
  assert.match(script, /files remain in Files/);
  assert.doesNotMatch(script, /check-certificate=no/);
});

test("compact bootstrap rejects missing, out-of-order, insecure, or unsafe stages", () => {
  assert.throws(() => buildCompactSelfInstallBootstrap([...stages.slice(0, 2)]), /requires network, VPN, and services/);
  assert.throws(
    () => buildCompactSelfInstallBootstrap([stages[1], stages[0], stages[2]]),
    /stage must be network/,
  );
  assert.throws(
    () => buildCompactSelfInstallBootstrap([
      { ...stages[0], sourceUrl: "http://tenant.isplatty.com/stage" },
      stages[1],
      stages[2],
    ]),
    /must use HTTPS/,
  );
  assert.throws(
    () => buildCompactSelfInstallBootstrap([
      { ...stages[0], fileName: "../networksetup.rsc" },
      stages[1],
      stages[2],
    ]),
    /filename is invalid/,
  );
});
