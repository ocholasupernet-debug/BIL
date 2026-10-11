import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portal = readFileSync(new URL("../../public/hotspot/login.html", import.meta.url), "utf8");
const verifyPortal = readFileSync(new URL("../../scripts/verify-hotspot-portal-output.mjs", import.meta.url), "utf8");

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
