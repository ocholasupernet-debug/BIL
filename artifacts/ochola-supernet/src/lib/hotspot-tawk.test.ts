import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portal = readFileSync(new URL("../../public/hotspot/login.html", import.meta.url), "utf8");
const verifyPortal = readFileSync(new URL("../../scripts/verify-hotspot-portal-output.mjs", import.meta.url), "utf8");

test("Tawk is loaded only after chat-account authentication and signs in the stable account identity", () => {
  assert.match(portal, /\/api\/public\/hotspot-chat\/auth/);
  assert.match(portal, /action:action/);
  assert.match(portal, /window\.Tawk_API\.login\(\{userId:identity\.userId,hash:identity\.hash\}/);
  assert.match(portal, /Your previous chat history is ready/);
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
