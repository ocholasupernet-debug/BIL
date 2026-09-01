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
const generatedDeployEnabled = process.env["HOTSPOT_PORTAL_DEPLOY_LIVE_STAGING"] === "1";
const generatedDeployAck = process.env["HOTSPOT_PORTAL_STAGING_ACK"] ?? "";
const generatedApiOrigin = (process.env["HOTSPOT_PORTAL_STAGING_API_ORIGIN"] ?? "").trim().replace(/\/+$/, "");
const generatedRouterId = (process.env["HOTSPOT_PORTAL_STAGING_ROUTER_ID"] ?? "").trim();
const generatedAdminId = (process.env["HOTSPOT_PORTAL_STAGING_ADMIN_ID"] ?? "").trim();
const generatedApiToken = process.env["HOTSPOT_PORTAL_STAGING_API_TOKEN"] ?? "";
const generatedAllowReplace = process.env["HOTSPOT_PORTAL_STAGING_ALLOW_REPLACE"] === "1";

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

test("deploys the exact generated branded portal through the tenant endpoint", {
  skip: !generatedDeployEnabled
    ? "Set HOTSPOT_PORTAL_DEPLOY_LIVE_STAGING=1 with explicit non-production endpoint values to run this live smoke test."
    : false,
}, async () => {
  assert.equal(
    generatedDeployAck,
    "NON_PRODUCTION_ROUTER_CONFIRMED",
    "generated portal smoke test requires explicit non-production router confirmation",
  );
  assert.ok(
    isNonProductionSource(generatedApiOrigin),
    "generated portal API origin must be HTTPS on an explicitly staging host",
  );
  assert.match(generatedRouterId, /^[1-9]\d*$/, "staging router id is required");
  assert.match(generatedAdminId, /^[1-9]\d*$/, "staging administrator id is required");
  if (generatedAllowReplace) {
    assert.equal(
      process.env["HOTSPOT_PORTAL_STAGING_OVERWRITE_ACK"],
      "ALLOW_STAGING_LOGIN_REPLACEMENT",
      "replacing an existing staging login.html requires explicit confirmation",
    );
  }

  const template = await readFile(
    resolve(import.meta.dirname, "../../ochola-supernet/public/hotspot/login.html"),
    "utf8",
  );
  const generatedConfig = {
    apiBase: generatedApiOrigin,
    ispName: "Staging Portal ISP",
    tagline: "Disposable RouterOS verification",
    logoUrl: "",
    advertUrl: "",
    advertEnabled: false,
    advertPosition: "Bottom",
    vouchersEnabled: true,
    freeTrialEnabled: true,
    announcement: "Non-production smoke test",
  };
  const generatedHtml = template
    .replace(
      "</head>",
      `<script>window.__HOTSPOT_CONFIG__=${JSON.stringify(generatedConfig)};</script>\n</head>`,
    )
    .replace(/\$\(login-title\)/g, "Staging Portal ISP");
  for (const macro of ["$(link-login-only)", "$(link-orig)", "$(if error)", "$(endif error)", "$(username)"]) {
    assert.ok(generatedHtml.includes(macro), `generated export lost RouterOS macro ${macro}`);
  }
  assert.match(generatedHtml, /window\.__HOTSPOT_CONFIG__=/);
  assert.doesNotMatch(generatedHtml, /router[_-]?secret|vpn[_-]?private|session[_-]?secret/i);

  const request = async (path: string, init: RequestInit = {}): Promise<{ response: Response; data: Record<string, unknown> }> => {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    if (generatedApiToken) headers.set("Authorization", `Bearer ${generatedApiToken}`);
    const response = await fetch(`${generatedApiOrigin}${path}`, { ...init, headers });
    let data: Record<string, unknown> = {};
    try {
      data = await response.json() as Record<string, unknown>;
    } catch {
      /* Keep the status as the failure detail when the endpoint is unavailable. */
    }
    return { response, data };
  };

  const listFiles = async (): Promise<Array<{ name: string; size: number; id?: string }>> => {
    const result = await request(
      `/api/router/${generatedRouterId}/files?adminId=${encodeURIComponent(generatedAdminId)}`,
    );
    assert.equal(result.response.status, 200, `router file metadata request failed with HTTP ${result.response.status}`);
    return Array.isArray(result.data.files) ? result.data.files as Array<{ name: string; size: number; id?: string }> : [];
  };

  const deployGenerated = async (allowOverwrite: boolean) => request(
    `/api/router/${generatedRouterId}/hotspot-portal/deploy`,
    {
      method: "POST",
      body: JSON.stringify({
        adminId: Number(generatedAdminId),
        html: generatedHtml,
        overwrite: allowOverwrite,
      }),
    },
  );

  const before = (await listFiles()).find(file => file.name === "hotspot/login.html");
  const first = await deployGenerated(false);
  if (before) {
    assert.equal(first.response.status, 409, "an existing staging login.html must produce a conflict before replacement");
    assert.ok(first.data.existingFile, "conflict response must identify the existing file");

    /* This is the live equivalent of declining the UI's second confirmation:
       no overwrite request is sent, and the existing metadata must not move. */
    const afterCancel = (await listFiles()).find(file => file.name === "hotspot/login.html");
    assert.deepEqual(afterCancel, before, "declining replacement must leave the existing portal unchanged");

    if (!generatedAllowReplace) return;
    const replacement = await deployGenerated(true);
    assert.equal(replacement.response.status, 201);
    assert.equal(replacement.data.replaced, true);
  } else {
    assert.equal(first.response.status, 201, `initial generated deployment failed with HTTP ${first.response.status}`);
    assert.equal(first.data.replaced, false);
  }

  const uploaded = (await listFiles()).find(file => file.name === "hotspot/login.html");
  assert.ok(uploaded, "RouterOS did not list the generated hotspot login.html");
  assert.equal(uploaded.size, Buffer.byteLength(generatedHtml, "utf8"));
  assert.doesNotMatch(JSON.stringify(first.data), /router[_-]?secret|password|vpn[_-]?private|session[_-]?secret/i);

  /* Invalid generated content must fail before any replacement write. */
  const invalid = await request(
    `/api/router/${generatedRouterId}/hotspot-portal/deploy`,
    {
      method: "POST",
      body: JSON.stringify({
        adminId: Number(generatedAdminId),
        html: generatedHtml.replace("$(link-orig)", ""),
        overwrite: true,
      }),
    },
  );
  assert.equal(invalid.response.status, 400);
  const afterFailedReplacement = (await listFiles()).find(file => file.name === "hotspot/login.html");
  assert.deepEqual(afterFailedReplacement, uploaded, "a rejected replacement must leave the uploaded portal unchanged");
});