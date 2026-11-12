import assert from "node:assert/strict";
import test from "node:test";
import { buildSelfInstallBundle } from "./self-install-bundle.js";

test("single bundle contains tagged sections in order and aborts after errors", () => {
  const bundle = buildSelfInstallBundle([
    { tag: "network", content: ":put \"network\"" },
    { tag: "vpn", content: ":put \"vpn\"" },
    { tag: "services", content: ":put \"services\"" },
  ]);
  assert.ok(bundle.indexOf("1/3 NETWORK") < bundle.indexOf("2/3 VPN"));
  assert.ok(bundle.indexOf("2/3 VPN") < bundle.indexOf("3/3 SERVICES"));
  assert.match(bundle, /:onerror ocholaBundleError1 in=\{/);
  assert.match(bundle, /:onerror ocholaBundleError2 in=\{/);
  assert.match(bundle, /:onerror ocholaBundleError3 in=\{/);
  assert.match(bundle, /bundle stopped at 1\/3 NETWORK: " \. \$ocholaBundleError1/);
  assert.doesNotMatch(bundle, /\$error\b| on-error=/);
});
