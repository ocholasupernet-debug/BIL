import assert from "node:assert/strict";
import test from "node:test";
import { addVlanIdentityToRlogin } from "./vlan-hotspot-portal.js";

test("reseller rlogin redirects with the RouterOS identity and exact HotSpot server name", () => {
  const source = `<!doctype html>
<html><head><meta http-equiv="refresh" content="0;url=$(link-login-only)"></head>
<body><a href="$(link-login-only)">Continue</a></body></html>`;

  const output = addVlanIdentityToRlogin(source);

  assert.doesNotMatch(output, /http-equiv=["']refresh/i);
  assert.match(output, /data-nasid="\$\(identity\)"/);
  assert.match(output, /data-server-name="\$\(server-name\)"/);
  assert.match(output, /searchParams\.set\("nasid"/);
  assert.match(output, /searchParams\.set\("server"/);
  assert.match(output, /link-login-only/);
});