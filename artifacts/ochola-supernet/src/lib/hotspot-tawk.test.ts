import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portal = readFileSync(new URL("../../public/hotspot/login.html", import.meta.url), "utf8");
const verifyPortal = readFileSync(new URL("../../scripts/verify-hotspot-portal-output.mjs", import.meta.url), "utf8");
const reactPortal = readFileSync(new URL("../pages/portal/HotspotLogin.tsx", import.meta.url), "utf8");

test("Tawk icon is available first, reveals sign-in on click, and restores the stable account identity", () => {
  assert.match(portal, /\/api\/public\/hotspot-chat\/auth/);
  assert.match(portal, /action:action/);
  assert.match(portal, /window\.Tawk_API\.login\(\{userId:pendingIdentity\.userId,hash:pendingIdentity\.hash\}/);
  assert.match(portal, /Your previous conversation will continue/);
  assert.match(portal, /panel\.hidden=true;/);
  assert.match(portal, /credentials\.hidden=true;/);
  assert.match(portal, /window\.Tawk_API\.onChatMaximized=function\(\)/);
  assert.match(portal, /showChatPrompt\(\);/);
  assert.match(portal, /window\.Tawk_API\.minimize\(\)/);
  assert.ok(portal.indexOf("tawkScript.src=") < portal.indexOf("if(savedToken)"));
  assert.match(portal, /hotspot-chat-register/);
  assert.match(portal, /hotspot-chat-login/);
  assert.match(portal, /ochola_hotspot_chat_remember_v1_/);
  assert.match(portal, /authenticate\("resume",savedToken\)/);
  assert.match(portal, /payload\.rememberToken=rememberToken/);
  assert.match(portal, /deviceMac:deviceMac/);
  assert.match(portal, /Your password is never saved here/);
  assert.match(portal, /hotspot-chat-password"\)\.value=""/);
  assert.match(verifyPortal, /Tawk\.to must remain opt-in through Hotspot Settings/);
  assert.doesNotMatch(portal, /window\.Tawk_API\.login\(\{[^}]*macAddress/);
});

test("Tawk launcher is draggable, remembers its placement, and hides the overlapping default bubble", () => {
  assert.match(portal, /Move chat button or open live chat/);
  assert.match(portal, /pointerdown/);
  assert.match(portal, /pointermove/);
  assert.match(portal, /localStorage\.setItem\(launcherKey/);
  assert.match(portal, /window\.Tawk_API\.hideWidget\(\)/);
  assert.match(portal, /bottom:88px/);
  assert.match(portal, /chatLauncher\.style\.display="none"/);
  assert.match(portal, /chatLauncher\.style\.display="grid"/);
});

test("paid portal success does not display assigned hotspot credentials", () => {
  assert.match(portal, /var credentialBlock=""/);
  assert.doesNotMatch(portal, /credentialBlock\+hotspotCredentials/);
  assert.doesNotMatch(reactPortal, /assigned username and password are shown below/);
  assert.doesNotMatch(reactPortal, /hotspotCredentials\.username\}</);
  assert.match(reactPortal, /paymentElapsedSeconds/);
  assert.match(portal, /id="stkWaitTimer"/);
});

test("purchase checkout remembers the last tenant-scoped Safaricom number without auto-sending", () => {
  assert.match(portal, /paymentPhoneStorageKey\(\)/);
  assert.match(portal, /readLastPaymentPhone\(\)/);
  assert.match(portal, /placeholder="Safaricom number/);
  assert.match(portal, /rememberPaymentPhone\(phone\)/);
  assert.match(reactPortal, /paymentPhoneStorageKey/);
  assert.match(reactPortal, /Send M-Pesa prompt/);
});
