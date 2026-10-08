import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCaptivePortalApiUrl,
  mergeRouterDhcpOptionNames,
  routerOsDhcpOptionUriValue,
} from "./captive-portal-discovery.js";

test("captive portal discovery URL uses the public API origin and validated tenant hostname", () => {
  assert.equal(
    buildCaptivePortalApiUrl("https://api.example.org/base/path", "WiFi.Example.org"),
    "https://api.example.org/api/captive-portal?portal=wifi.example.org",
  );
  assert.throws(
    () => buildCaptivePortalApiUrl("javascript:alert(1)", "wifi.example.org"),
    /must be an HTTP\(S\) URL/,
  );
  assert.throws(
    () => buildCaptivePortalApiUrl("https://api.example.org", "bad hostname"),
    /invalid for captive-portal discovery/,
  );
});

test("RouterOS URI value is single-quoted and existing DHCP options remain intact", () => {
  assert.equal(
    routerOsDhcpOptionUriValue("https://api.example.org/api/captive-portal?portal=wifi.example.org"),
    "'https://api.example.org/api/captive-portal?portal=wifi.example.org'",
  );
  assert.equal(
    mergeRouterDhcpOptionNames("existing,other", "captive_portal"),
    "existing,other,captive_portal",
  );
  assert.equal(
    mergeRouterDhcpOptionNames("captive_portal,existing", "captive_portal"),
    "captive_portal,existing",
  );
});
