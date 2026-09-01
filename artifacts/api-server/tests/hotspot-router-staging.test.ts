import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  deployRouterFile,
  fetchRouterFiles,
  fetchRouterLiveData,
  type RouterCredentials,
} from "../src/lib/mikrotik";

const enabled = process.env["HOTSPOT_ROUTER_LIVE_STAGING"] === "1";
const stagingAck = process.env["HOTSPOT_ROUTER_STAGING_ACK"] ?? "";
const sourceUrl = (process.env["HOTSPOT_STAGING_SOURCE_URL"] ?? "").trim();
const routerHost = (process.env["HOTSPOT_STAGING_ROUTER_HOST"] ?? "").trim();
const routerPassword = process.env["HOTSPOT_STAGING_ROUTER_PASSWORD"] ?? "";
const routerUsername = process.env["HOTSPOT_STAGING_ROUTER_USERNAME"] ?? "admin";
const routerOsVersion = (process.env["HOTSPOT_STAGING_ROUTEROS_VERSION"] ?? "").trim();
const apiOrigin = (process.env["HOTSPOT_STAGING_API_ORIGIN"] ?? "").trim().replace(/\/+$/, "");
const destinationPath = (process.env["HOTSPOT_STAGING_DESTINATION"] ?? "hotspot/login.html").trim();
const overwrite = process.env["HOTSPOT_STAGING_ALLOW_REPLACE"] === "1";

function isPublicHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !/^(localhost|127\.|0\.0\.0\.0)$/i.test(hostname);
  } catch {
    return false;
  }
}

function isNonProductionSource(value: string): boolean {
  if (!isPublicHttpsOrigin(value)) return false;
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname !== "isplatty.org"
    && hostname !== "www.isplatty.org"
    && (hostname.includes("staging") || hostname.endsWith(".test") || hostname.endsWith(".invalid"));
}

test("uploads the generated hotspot portal to a disposable RouterOS staging router", {
  skip: !enabled
    ? "Set HOTSPOT_ROUTER_LIVE_STAGING=1 with explicit staging values to run the live smoke test."
    : false,
}, async () => {
  assert.equal(
    stagingAck,
    "NON_PRODUCTION_ROUTER_CONFIRMED",
    "live smoke test requires explicit non-production router confirmation",
  );
  assert.ok(isNonProductionSource(sourceUrl), "source URL must be HTTPS on an explicitly staging host");
  assert.ok(isPublicHttpsOrigin(apiOrigin), "tenant API origin must be public HTTPS");
  assert.ok(routerHost, "staging router host is required");
  assert.ok(routerPassword, "staging router password must be provided through the environment");
  assert.match(routerOsVersion, /^\d+\.\d+/, "RouterOS version must be recorded");
  assert.match(destinationPath, /^(?:(?:flash|disk1)\/)?hotspot\/login\.html$/i);
  if (overwrite) {
    assert.equal(
      process.env["HOTSPOT_STAGING_OVERWRITE_ACK"],
      "ALLOW_STAGING_LOGIN_REPLACEMENT",
      "replacing an existing staging login.html requires explicit confirmation",
    );
  }

  const template = await readFile(resolve(import.meta.dirname, "../../ochola-supernet/public/hotspot/login.html"), "utf8");
  for (const macro of ["$(link-login-only)", "$(link-orig)", "$(if error)", "$(endif error)", "$(username)"]) {
    assert.ok(template.includes(macro), `portal template lost RouterOS macro ${macro}`);
  }
  assert.match(template, /<script src="\/hotspot\/md5\.js"><\/script>/);
  assert.doesNotMatch(template, /router[_-]?secret|vpn[_-]?private|session[_-]?secret/i);

  /* The staged source must be the persistent generated export that the
     router will fetch. Reading it once here is safe because one-time upload
     sources are intentionally not accepted for this live probe. */
  const sourceResponse = await fetch(sourceUrl);
  assert.equal(sourceResponse.status, 200);
  const sourceHtml = await sourceResponse.text();
  for (const macro of ["$(link-login-only)", "$(link-orig)", "$(if error)", "$(endif error)", "$(username)"]) {
    assert.ok(sourceHtml.includes(macro), `staged export lost RouterOS macro ${macro}`);
  }
  const configMatch = sourceHtml.match(/window\.__HOTSPOT_CONFIG__=(.*);<\/script>/);
  assert.ok(configMatch, "staged source is missing the generated hotspot configuration");
  const config = JSON.parse(configMatch[1]) as { apiBase?: unknown };
  assert.equal(config.apiBase, apiOrigin);
  assert.doesNotMatch(sourceHtml, /router[_-]?secret|vpn[_-]?private|session[_-]?secret/i);

  const credentials: RouterCredentials = {
    host: routerHost,
    port: Number(process.env["HOTSPOT_STAGING_ROUTER_PORT"] ?? "8729"),
    username: routerUsername,
    password: routerPassword,
    useSSL: process.env["HOTSPOT_STAGING_ROUTER_SSL"] !== "false",
    bridgeIp: process.env["HOTSPOT_STAGING_ROUTER_BRIDGE_IP"]?.trim() || undefined,
    connectTimeoutMs: 10_000,
    requestTimeoutMs: 30_000,
  };

  const live = await fetchRouterLiveData(credentials);
  assert.match(live.version, new RegExp(`^${routerOsVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  const result = await deployRouterFile(credentials, {
    destinationPath,
    sourceUrl,
    overwrite,
    uploadId: `hotspot-staging-${Date.now().toString(36)}`,
  });
  assert.equal(result.destinationPath, destinationPath);
  assert.ok(result.size > 0);

  const files = await fetchRouterFiles(credentials);
  const uploaded = files.files.find(file => file.name === destinationPath);
  assert.ok(uploaded, `RouterOS ${routerOsVersion} did not list ${destinationPath} after upload`);
  assert.equal(uploaded.size, result.size);
  if (!overwrite) assert.equal(result.replaced, false);
});