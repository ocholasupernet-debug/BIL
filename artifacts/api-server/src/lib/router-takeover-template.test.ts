import test from "node:test";
import assert from "node:assert/strict";
import { validateRouterTakeoverMainhotspot } from "./router-takeover-template.js";

const legacyMainhotspot = `# Main ISP Ledger Setup Script (mainhotspot.rsc)
# Checks version, downloads and imports VPN, hotspot, PPPoE, and users setups.
:global version [/system package update get installed-version]
:if ([/ping 8.8.8.8 count=3] = 0) do={ :error "No internet connection." }
/tool fetch url="https://legacy.invalid/scripts/vpn7.rsc" dst-path=vpnsetup.rsc mode=https
/import vpnsetup.rsc
/tool fetch url="https://legacy.invalid/scripts/hotspotsetup.rsc" dst-path=hotspotsetup.rsc mode=https
/import hotspotsetup.rsc
/tool fetch url="https://legacy.invalid/scripts/pppoesetup.rsc" dst-path=pppoesetup.rsc mode=https
/import pppoesetup.rsc
/tool fetch url="https://proxy.invalid/ipp.php" output=user
/system scheduler add name="dns-flush" interval=06:00:00 on-event="/ip dns cache flush"
/system logging set [find topics="warning"] topics=warning,!script
`;

test("Takeover accepts the single mainhotspot bootstrap as a read-only layout reference", () => {
  assert.equal(validateRouterTakeoverMainhotspot({
    sourceRouterId: 11,
    fileName: "flash/mainhotspot.rsc",
    content: legacyMainhotspot,
  }), undefined);
});

test("Takeover rejects source files other than mainhotspot.rsc", () => {
  assert.throws(
    () => validateRouterTakeoverMainhotspot({
      sourceRouterId: 11,
      fileName: "networksetup.rsc",
      content: legacyMainhotspot,
    }),
    /reads only.*mainhotspot\.rsc/,
  );
});

test("Takeover rejects a mainhotspot file without shared checks and both service stages", () => {
  assert.throws(
    () => validateRouterTakeoverMainhotspot({
      sourceRouterId: 11,
      fileName: "mainhotspot.rsc",
      content: `# mainhotspot.rsc\n/tool fetch url="https://old.example/vpn.rsc"`,
    }),
    /missing its RouterOS version check/,
  );
});

test("Takeover requires a numeric source router ID", () => {
  assert.throws(
    () => validateRouterTakeoverMainhotspot({
      sourceRouterId: 0,
      fileName: "mainhotspot.rsc",
      content: legacyMainhotspot,
    }),
    /valid source router/,
  );
});
