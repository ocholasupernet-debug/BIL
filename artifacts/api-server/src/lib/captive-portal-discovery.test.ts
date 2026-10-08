import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCaptivePortalApiUrl,
  buildCaptivePortalContinueUrl,
  getCaptivePortalApiOrigin,
  isAuthorizedCaptivePortalHostname,
  mergeRouterDhcpOptionNames,
  routerOsDhcpOptionUriValue,
} from "./captive-portal-discovery.js";

process.env.TOKEN_SIGNING_SECRET ??= "test-captive-portal-signing-secret";

test("captive portal discovery URL uses the public API origin and validated tenant hostname", () => {
  const url = new URL(buildCaptivePortalApiUrl("https://api.example.org/base/path", "WiFi.Example.org"));
  assert.equal(
    url.origin,
    "https://api.example.org",
  );
  assert.equal(url.pathname, "/api/captive-portal");
  assert.equal(url.searchParams.get("portal"), "wifi.example.org");
  assert.equal(isAuthorizedCaptivePortalHostname(
    "wifi.example.org",
    url.searchParams.get("sig"),
  ), true);
  assert.equal(isAuthorizedCaptivePortalHostname(
    "other.example.org",
    url.searchParams.get("sig"),
  ), false);
  assert.throws(
    () => buildCaptivePortalApiUrl("javascript:alert(1)", "wifi.example.org"),
    /must use HTTPS/,
  );
  assert.throws(
    () => buildCaptivePortalApiUrl("http://api.example.org", "wifi.example.org"),
    /must use HTTPS/,
  );
  assert.throws(
    () => buildCaptivePortalApiUrl("https://api.example.org", "bad hostname"),
    /invalid for captive-portal discovery/,
  );
});

test("captive discovery avoids the tenant Hotspot hostname and advertises a TLS handoff", () => {
  const apiUrl = new URL(buildCaptivePortalApiUrl(
    "https://come.isplatty.org",
    "come.isplatty.org",
  ));
  assert.equal(apiUrl.origin, getCaptivePortalApiOrigin());
  assert.equal(apiUrl.pathname, "/api/captive-portal");
  assert.equal(apiUrl.searchParams.get("portal"), "come.isplatty.org");

  const portalUrl = new URL(buildCaptivePortalContinueUrl(
    getCaptivePortalApiOrigin(),
    "come.isplatty.org",
  ));
  assert.equal(portalUrl.protocol, "https:");
  assert.equal(portalUrl.origin, getCaptivePortalApiOrigin());
  assert.equal(portalUrl.pathname, "/api/captive-portal/continue");
  assert.equal(isAuthorizedCaptivePortalHostname(
    portalUrl.searchParams.get("portal")!,
    portalUrl.searchParams.get("sig"),
  ), true);
});

test("RouterOS URI value is single-quoted and existing DHCP options remain intact", () => {
  const uri = buildCaptivePortalApiUrl("https://api.example.org", "wifi.example.org");
  assert.equal(routerOsDhcpOptionUriValue(uri), `'${uri}'`);
  assert.equal(
    mergeRouterDhcpOptionNames("existing,other", "captive_portal"),
    "existing,other,captive_portal",
  );
  assert.equal(
    mergeRouterDhcpOptionNames("captive_portal,existing", "captive_portal"),
    "captive_portal,existing",
  );
});
