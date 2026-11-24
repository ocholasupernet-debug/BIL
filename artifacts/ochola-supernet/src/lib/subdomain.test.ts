import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HotspotMemberLogin from "../pages/portal/HotspotMemberLogin.js";
import { shouldShowHotspotMemberLoginAtRoot } from "./subdomain.js";

const memberLoginSource = readFileSync(
  new URL("../pages/portal/HotspotMemberLogin.tsx", import.meta.url),
  "utf8",
);

test("only a server-marked tenant root opens the member sign-in first", () => {
  assert.equal(shouldShowHotspotMemberLoginAtRoot("/", 33, "member-login"), true);
  assert.equal(shouldShowHotspotMemberLoginAtRoot("/", "33", "member-login"), true);
  assert.equal(shouldShowHotspotMemberLoginAtRoot("/", 33, undefined), false);
  assert.equal(shouldShowHotspotMemberLoginAtRoot("/", 33, "purchase"), false);
  assert.equal(shouldShowHotspotMemberLoginAtRoot("/admin/login", 33, "member-login"), false);
  assert.equal(shouldShowHotspotMemberLoginAtRoot("/", null, "member-login"), false);
  assert.equal(shouldShowHotspotMemberLoginAtRoot("/", "not-an-id", "member-login"), false);
});

test("the member sign-in uses the scoped Hotspot login endpoint without storing passwords", () => {
  assert.match(memberLoginSource, /fetch\("\/api\/customers\/hotspot-login"/);
  assert.match(memberLoginSource, /mac_address:\s*macAddress/);
  assert.match(memberLoginSource, /href="\/admin\/login"/);
  assert.doesNotMatch(memberLoginSource, /localStorage|sessionStorage/);
});

test("the member login renders username, password, and a separate admin link", () => {
  const html = renderToStaticMarkup(createElement(HotspotMemberLogin));
  assert.match(html, /Member panel/);
  assert.match(html, /name="username"/);
  assert.match(html, /type="text"[^>]*name="username"|name="username"[^>]*type="text"/);
  assert.match(html, /name="password"/);
  assert.match(html, /href="\/admin\/login"/);
  assert.match(html, /Forgot password\?/);
  assert.doesNotMatch(html, /name="email"|ISPLATTY\.ISP|Need a member account|isplatty\.com|isplatty\.org/i);
});

test("Hotspot member recovery keeps contact values masked and credentials in memory only", () => {
  assert.match(memberLoginSource, /hotspot-password-recovery\/options/);
  assert.match(memberLoginSource, /hotspot-password-recovery\/request-code/);
  assert.match(memberLoginSource, /hotspot-password-recovery\/verify-code/);
  assert.match(memberLoginSource, /hotspot-password-recovery\/reset-password/);
  assert.match(memberLoginSource, /Email <strong>\{recoveryOptions\.email\.masked\}<\/strong>/);
  assert.match(memberLoginSource, /Phone <strong>\{recoveryOptions\.phone\.masked\}<\/strong>/);
  assert.doesNotMatch(memberLoginSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(memberLoginSource, /ISPLATTY\.ISP|isplatty\.com|isplatty\.org/i);
});
