/*
 * Regression coverage for the browser-generated hotspot login.html.
 *
 * The real HotspotSettings HTML builder is bundled with only UI/data
 * dependencies stubbed. The template and tenant-origin fetches are local
 * fixtures; no router, payment, session, or VPN service is contacted.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const apiRoot = resolve(import.meta.dirname, "..");
const webRoot = resolve(apiRoot, "../ochola-supernet");
const entry = resolve(webRoot, "src/pages/admin/HotspotSettings.tsx");
const templatePath = resolve(webRoot, "public/hotspot/login.html");
const rloginTemplatePath = resolve(webRoot, "public/hotspot/rlogin.html");
const mikrotikRoutePath = resolve(apiRoot, "src/routes/mikrotik-route.ts");
const resellerRoutePath = resolve(apiRoot, "src/routes/reseller-route.ts");
const mpesaRoutePath = resolve(apiRoot, "src/routes/mpesa-route.ts");

async function loadExportBuilder(role = "isp_admin") {
  const outdir = await mkdtemp(resolve(webRoot, ".hotspot-export-"));
  const outfile = resolve(outdir, "HotspotSettings.cjs");
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["react", "@tanstack/react-query", "lucide-react"],
    logLevel: "silent",
    plugins: [{
      name: "hotspot-export-test-adapters",
      setup(plugin) {
        plugin.onResolve({ filter: /^@\// }, args => {
          const virtual = {
            "@/components/layout/AdminLayout": "admin-layout",
            "@/context/BrandContext": "brand-context",
            "@/lib/supabase": "supabase",
          }[args.path];
          return virtual ? { path: virtual, namespace: "test-adapter" } : undefined;
        });
        plugin.onLoad({ filter: /.*/, namespace: "test-adapter" }, args => {
          const modules = {
            "admin-layout": `export function AdminLayout({ children }) { return children; }`,
            "brand-context": `export function useBrand() { return { domain: "tenant", ispName: "Staging ISP" }; }`,
            "supabase": `
              export const ADMIN_ID = 7;
              export function getAdminApiToken() { return ""; }
              export function getAdminRole() { return ${JSON.stringify(role)}; }
              export function getSelectedTenantId() { return 7; }
              export function isLoggedIn() { return false; }
              export const supabase = { from() { throw new Error("supabase should not be called by HTML export"); } };
            `,
          };
          return { contents: modules[args.path], loader: "js" };
        });
      },
    }],
  });
  const module = await import(`${pathToFileURL(outfile).href}?test=${Date.now()}`);
  return {
    buildPortalHtml: module.buildPortalHtml,
    cleanup: () => rm(outdir, { recursive: true, force: true }),
  };
}

function stagingSettings() {
  return {
    ispName: "Acme <script>alert('x')</script>",
    portalHostname: "",
    freeTrial: "Enable",
    vouchers: "Yes",
    mpesaPrompt: "Enable",
    tagline: "Fast & <reliable>",
    routerId: "3",
    advertPos: "Bottom",
    enableAdvert: "Enable",
    testimonials: "Enable",
    faqSection: "Enable",
    logoUrl: "data:image/png;base64,STAGING_LOGO",
    advertUrl: "data:image/png;base64,STAGING_ADVERT",
    announcement: "Welcome to the staging network.",
    paymentInstructions: "Approve the M-Pesa prompt on your registered phone.",
    supportPhone: "0700000000",
    supportEmail: "support@example.test",
    whatsappNumber: "254700000000",
    termsUrl: "https://tenant.example.test/terms",
    privacyUrl: "https://tenant.example.test/privacy",
    maintenanceMode: "Online",
    maintenanceMessage: "Staging maintenance message.",
    testimonialText: "Reliable staging service.",
    faqText: "How do I connect?\nChoose a package.",
    colors: {
      bgColor: "#081416",
      bgColor2: "#173638",
      primaryColor: "#d96835",
      accentColor: "#f09562",
      cardColor: "#12292b",
      buttonColor: "#168c78",
      textColor: "#ffffff",
      inputBgColor: "#0b1d1f",
    },
  };
}

function embeddedPortalConfig(html) {
  const prefix = "window.__HOTSPOT_CONFIG__=";
  const suffix = ";document.documentElement.setAttribute(\"data-portal-layout\"";
  const start = html.indexOf(prefix);
  assert.notEqual(start, -1, "generated portal config bootstrap is present");
  const jsonStart = start + prefix.length;
  const end = html.indexOf(suffix, jsonStart);
  assert.notEqual(end, -1, "generated portal config ends before its layout bootstrap");
  return JSON.parse(html.slice(jsonStart, end));
}

test("HTML export preserves RouterOS macros and safely embeds tenant configuration", async () => {
  const template = await readFile(templatePath, "utf8");
  const builder = await loadExportBuilder();
  const calls = [];
  const sensitiveFixtures = [
    "ROUTER_SECRET_SHOULD_NOT_EXPORT",
    "PAYMENT_CONSUMER_SECRET_SHOULD_NOT_EXPORT",
    "SESSION_SECRET_SHOULD_NOT_EXPORT",
    "VPN_PRIVATE_KEY_SHOULD_NOT_EXPORT",
  ];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const raw = String(input);
    calls.push(raw);
    const url = new URL(raw, "https://tenant.example.test");
    if (url.pathname === "/hotspot/login.html") {
      return new Response(template, { status: 200 });
    }
    if (url.pathname === "/api/public/typography") {
      return new Response(JSON.stringify({ apiBase: "https://tenant.example.test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname === "/api/plans") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected export request: ${raw}`);
  };

  try {
    const html = await builder.buildPortalHtml(stagingSettings(), "tenant", {}, { portId: 88 });
    for (const macro of [
      "$(link-login-only)",
      "$(link-orig)",
      "$(if error)",
      "$(endif)",
      "$(username)",
    ]) assert.match(html, new RegExp(`\\$\\(${macro.slice(2, -1)}\\)`));
    assert.match(html, /name="password" type="password"/);
    assert.match(html, /<script src="\/hotspot\/md5\.js"><\/script>/);
    assert.match(html, /Acme &lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>alert\('x'\)<\/script>/);

    const config = embeddedPortalConfig(html);
    assert.equal(config.apiBase, "https://tenant.example.test");
    assert.equal(config.routerId, 3);
    assert.equal(config.portId, 88);
    assert.equal(config.ispName, stagingSettings().ispName);
    assert.equal(config.freeTrialEnabled, true);
    assert.equal(config.vouchersEnabled, true);
    assert.equal(config.mpesaPromptEnabled, true);
    for (const key of [
      "routerSecret",
      "routerPassword",
      "paymentSecret",
      "sessionSecret",
      "vpnPrivateKey",
    ]) assert.equal(config[key], undefined, `${key} must not be embedded in portal config`);

    for (const value of sensitiveFixtures) assert.doesNotMatch(html, new RegExp(value));
    assert.equal(calls.length, 3);
    assert.match(calls.find(url => url.includes("/api/plans")) || "", /routerId=3/);
    assert.match(calls.find(url => url.includes("/api/plans")) || "", /portId=88/);
    assert.match(calls.find(url => url.includes("/api/plans")) || "", /activeOnly=true/);
    assert.match(calls.find(url => url.includes("/api/plans")) || "", /purchasableOnly=true/);
    assert.ok(calls.every(url => !/\/api\/admin|\/router|\/sync|\/upload/i.test(url)));
  } finally {
    globalThis.fetch = realFetch;
    await builder.cleanup();
  }
});

test("local hotspot preview keeps embedded plans instead of refreshing them away", async () => {
  const template = await readFile(templatePath, "utf8");
  const builder = await loadExportBuilder();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input), "https://tenant.example.test");
    if (url.pathname === "/hotspot/login.html") return new Response(template, { status: 200 });
    if (url.pathname === "/api/public/typography") {
      return new Response(JSON.stringify({ apiBase: "https://tenant.example.test" }), { status: 200 });
    }
    if (url.pathname === "/api/plans") {
      return new Response(JSON.stringify([{
        id: 41,
        name: "Preview 10 Mbps",
        price: 50,
        validity: 1,
        validity_unit: "days",
      }]), { status: 200 });
    }
    throw new Error(`unexpected preview request: ${String(input)}`);
  };

  try {
    const html = await builder.buildPortalHtml(stagingSettings(), "tenant", {}, {
      portId: 88,
      previewOnly: true,
    });
    const config = embeddedPortalConfig(html);
    assert.equal(config.previewOnly, true);
    assert.deepEqual(config.plans, [{
      id: 41,
      name: "Preview 10 Mbps",
      price: 50,
      validity: 1,
      validity_unit: "days",
    }]);
    assert.match(html, /function renderPlans\(\)/);
    assert.doesNotMatch(html, /data-plan-id=/);
    assert.match(await readFile(templatePath, "utf8"), /PORTAL_PREVIEW_ONLY\|\|planRequestInFlight/);
  } finally {
    globalThis.fetch = realFetch;
    await builder.cleanup();
  }
});

test("ISP assigned-port preview and export use only that service's eligible plans", async () => {
  const template = await readFile(templatePath, "utf8");
  const builder = await loadExportBuilder();
  const realFetch = globalThis.fetch;
  const calls = [];
  let planResponse = [{ id: 88, name: "WLAN 2 package", price: 50, validity: 1, validity_unit: "days" }];
  globalThis.fetch = async input => {
    const url = new URL(String(input), "https://tenant.example.test");
    calls.push(url);
    if (url.pathname === "/hotspot/login.html") return new Response(template);
    if (url.pathname === "/api/public/typography") {
      return new Response(JSON.stringify({ apiBase: "https://tenant.example.test" }));
    }
    if (url.pathname === "/api/plans") {
      assert.equal(url.searchParams.get("adminId"), "7");
      assert.equal(url.searchParams.get("routerId"), "3");
      assert.equal(url.searchParams.get("portId"), "88");
      assert.equal(url.searchParams.get("activeOnly"), "true");
      assert.equal(url.searchParams.get("purchasableOnly"), "true");
      return new Response(JSON.stringify(planResponse));
    }
    throw new Error(`unexpected assigned-port request: ${url}`);
  };

  try {
    for (const previewOnly of [true, false]) {
      const html = await builder.buildPortalHtml(stagingSettings(), "tenant", {}, { portId: 88, previewOnly });
      const config = embeddedPortalConfig(html);
      assert.equal(config.routerId, 3);
      assert.equal(config.portId, 88);
      assert.equal(config.previewOnly, previewOnly);
      assert.deepEqual(config.plans, planResponse);
      assert.match(html, /WLAN 2 package/);
    }
    // A truly empty assigned service must not show sibling or router-wide
    // packages through the generic admin preview fallback.
    planResponse = [];
    const html = await builder.buildPortalHtml(stagingSettings(), "tenant", {}, { portId: 88, previewOnly: true });
    const config = embeddedPortalConfig(html);
    assert.deepEqual(config.plans, []);
    assert.ok(calls.every(url => url.pathname !== "/api/plans/admin-context"));
  } finally {
    globalThis.fetch = realFetch;
    await builder.cleanup();
  }
});

test("assigned-port API failures do not silently create an empty preview or deployment", async () => {
  const template = await readFile(templatePath, "utf8");
  const builder = await loadExportBuilder();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input), "https://tenant.example.test");
    if (url.pathname === "/hotspot/login.html") return new Response(template);
    if (url.pathname === "/api/public/typography") return new Response("{}");
    if (url.pathname === "/api/plans") return new Response("unavailable", { status: 503 });
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    for (const previewOnly of [true, false]) {
      await assert.rejects(
        builder.buildPortalHtml(stagingSettings(), "tenant", {}, { portId: 88, previewOnly }),
        /selected service's plans could not be loaded \(HTTP 503\)/,
      );
    }
  } finally {
    globalThis.fetch = realFetch;
    await builder.cleanup();
  }
});

test("router-wide plan API failures abort export instead of producing an empty package portal", async () => {
  const template = await readFile(templatePath, "utf8");
  const builder = await loadExportBuilder();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input), "https://tenant.example.test");
    if (url.pathname === "/hotspot/login.html") return new Response(template);
    if (url.pathname === "/api/public/typography") return new Response("{}");
    if (url.pathname === "/api/plans") return new Response("unavailable", { status: 503 });
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    await assert.rejects(
      builder.buildPortalHtml(stagingSettings(), "tenant"),
      /Hotspot plans could not be loaded \(HTTP 503\)/,
    );
  } finally {
    globalThis.fetch = realFetch;
    await builder.cleanup();
  }
});

test("reseller preview fallback remains restricted to the selected assigned port", async () => {
  const template = await readFile(templatePath, "utf8");
  const builder = await loadExportBuilder("reseller");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input), "https://tenant.example.test");
    if (url.pathname === "/hotspot/login.html") return new Response(template);
    if (url.pathname === "/api/public/typography") return new Response("{}");
    if (url.pathname === "/api/plans") return new Response("[]");
    if (url.pathname === "/api/plans/admin-context") {
      return new Response(JSON.stringify({ plans: [
        { id: 1, name: "Selected port", type: "hotspot", router_id: 3, port_id: 88, price: 10 },
        { id: 2, name: "Sibling port", type: "hotspot", router_id: 3, port_id: 89, price: 20 },
        { id: 3, name: "Different router", type: "hotspot", router_id: 4, port_id: 88, price: 20 },
      ] }));
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    const html = await builder.buildPortalHtml(stagingSettings(), "tenant", {}, { portId: 88, previewOnly: true });
    const config = embeddedPortalConfig(html);
    assert.deepEqual(config.plans.map(plan => plan.id), [1]);
    assert.doesNotMatch(html, /Sibling port|Different router/);
  } finally {
    globalThis.fetch = realFetch;
    await builder.cleanup();
  }
});

test("assigned-service UI carries port scope into preview, export, and isolated deployment", async () => {
  const source = await readFile(entry, "utf8");
  assert.doesNotMatch(source, /isSuperAdmin\(\)|Super Admin must approve|Super Admin approval/i);
  assert.match(source, /label="Portal service"/);
  assert.match(source, /port \? \{ \.\.\.settings, routerId: String\(port\.router_id\) \}/);
  assert.match(source, /\{ portId: port\?\.id, previewOnly \}/);
  assert.match(source, /return buildTargetPortal\(selectedPortalPort\)/);
  assert.match(source, /const html = await buildTargetPortal\(port, true\)/);
  const savePort = source.slice(source.indexOf("const saveAssignedPort"), source.indexOf("const deleteAssignedPort"));
  assert.match(savePort, /usesGeneratedHotspotPortal\(draft\.hotspotFolderPath\)/);
  assert.match(savePort, /await buildTargetPortal\(port\)/);
  assert.match(savePort, /draft\.hotspotEnabled\s*&&\s*window\.confirm/);
  assert.match(savePort, /portalHtml \? \{ portalHtml \}/);
  assert.match(savePort, /portalFileReplacementConsent: allowHotspotReplace/);
  assert.doesNotMatch(savePort, /isSuperAdmin|Super Admin approval/i);
  assert.match(source, /await saveAssignedPort\(selectedPortalPort\)/);
});

test("invalid or internal API origins fall back to the public tenant HTTPS origin", async () => {
  const template = await readFile(templatePath, "utf8");
  const builder = await loadExportBuilder();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input), "https://tenant.example.test");
    if (url.pathname === "/hotspot/login.html") return new Response(template, { status: 200 });
    if (url.pathname === "/api/plans") return new Response("[]", { status: 200 });
    return new Response(JSON.stringify({ apiBase: "http://localhost:8080" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const html = await builder.buildPortalHtml(stagingSettings(), "tenant");
    const config = embeddedPortalConfig(html);
    assert.equal(config.apiBase, "https://tenant.isplatty.org");
    assert.doesNotMatch(html, /localhost:8080/);
    assert.doesNotMatch(html, /127\.0\.0\.1/);
  } finally {
    globalThis.fetch = realFetch;
    await builder.cleanup();
  }
});

test("export builder source keeps preview/download local-only", async () => {
  const source = await readFile(entry, "utf8");
  const downloadStart = source.indexOf("const handleDownload");
  const previewStart = source.indexOf("const handlePreview");
  const closePreviewStart = source.indexOf("const closePreview");
  const localActions = source.slice(downloadStart, previewStart);
  const previewActions = source.slice(previewStart, closePreviewStart);
  assert.match(localActions, /new Blob\(\[html\]/);
  assert.match(localActions, /URL\.createObjectURL/);
  assert.doesNotMatch(localActions, /\/api\/admin\/|\/sync|router.*write/i);
  assert.match(previewActions, /new Blob\(\[html\]/);
  assert.match(previewActions, /URL\.createObjectURL/);
  assert.doesNotMatch(previewActions, /\/api\/admin\/|\/sync|router.*write/i);
});

test("deploy UI uses two confirmations and sends generated content through the dedicated route", async () => {
  const source = await readFile(entry, "utf8");
  const deployStart = source.indexOf("const handleDeploy");
  const deployEnd = source.indexOf("const handlePreview");
  assert.ok(deployStart >= 0 && deployEnd > deployStart, "deploy handler is present");
  const deployActions = source.slice(deployStart, deployEnd);

  assert.equal((deployActions.match(/window\.confirm/g) ?? []).length, 3);
  assert.match(deployActions, /hotspot-portal\/deploy/);
  assert.match(deployActions, /deploy\(false\)/);
  assert.match(deployActions, /deploy\(true\)/);
  assert.match(deployActions, /status === 409/);
  assert.doesNotMatch(deployActions, /Super Admin approval|Super Admin must approve/i);
  assert.match(deployActions, /JSON\.stringify\(\{\s*adminId,\s*html,\s*overwrite,\s*portalFileReplacementConsent: overwrite,\s*destinationDirectory: "flash\/hotspot",?\s*\}\)/);
  assert.doesNotMatch(deployActions, /routerSecret|routerPassword|paymentSecret|vpnPrivateKey/);
});

test("generated portal route keeps tenant scope and one-time source cleanup", async () => {
  const source = await readFile(mikrotikRoutePath, "utf8");
  const routeStart = source.indexOf('router.post("/router/:id/hotspot-portal/deploy"');
  const routeEnd = source.indexOf('router.get("/router/:id/probe"', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, "generated portal route is present");
  const route = source.slice(routeStart, routeEnd);

  assert.match(route, /validateGeneratedHotspotPortal\(req\.body\?\.html\)/);
  assert.match(route, /getRouterCreds\(id, adminId\)/);
  assert.match(route, /\/api\/router-file-source\/\$\{token\}/);
  assert.match(route, /pendingRouterFileSources\.delete\(token\)/);
  assert.match(route, /overwrite/);
  assert.match(route, /RouterFileExistsError/);
  assert.doesNotMatch(route, /req\.body\?\.(?:password|secret|routerCredentials)/i);

  const sourceHandler = source.slice(source.indexOf('router.get("/router-file-source/:token"'), routeStart);
  assert.match(sourceHandler, /expiresAt <= Date\.now\(\)/);
  assert.match(sourceHandler, /pendingRouterFileSources\.delete\(token\)/);
});

test("only the come3 bridge portal opts out of maintenance package hiding", async () => {
  const source = await readFile(mikrotikRoutePath, "utf8");
  const routeStart = source.indexOf('router.post("/admin/router/:id/hotspot-portal/bridge-deploy"');
  const routeEnd = source.indexOf('router.post("/router/:id/hotspot-portal/sync-tenant-host"', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, "bridge portal deploy route is present");
  const route = source.slice(routeStart, routeEnd);

  assert.match(route, /getRouterCreds\(id, adminId\)/);
  assert.match(route, /found\.row\.name !== expectedRouterName/);
  assert.match(route, /selectUniqueActiveHotspotServer\(servers, bridgeName \|\| undefined\)/);
  assert.ok(
    route.indexOf("found.row.name !== expectedRouterName") < route.indexOf("const read = async"),
    "exact target-name verification runs before any RouterOS command",
  );
  assert.match(route, /\.\.\.\(found\.row\.name === "come3" \? \{ allowPackagesDuringMaintenance: true \} : \{\}\)/);
  assert.doesNotMatch(route, /id === 85/);
  assert.match(route, /for \(const fileName of \["login\.html", "rlogin\.html"\] as const\)/);
  assert.match(route, /getDeployableSource\("hotspot", "rlogin\.html"\)/);
  assert.match(route, /rloginSource\.content\.toString\("utf8"\)\.includes\("\$\(link-login-only\)"\)/);
  assert.match(route, /const pageContent = fileName === "login\.html" \? content : rloginSource\.content/);
  const portal = await readFile(templatePath, "utf8");
  assert.match(portal, /shouldHidePackageSection\(maintenance,allowPackagesDuringMaintenance\)/);
  assert.match(portal, /EMBEDDED_CONFIG&&EMBEDDED_CONFIG\.allowPackagesDuringMaintenance===true/);
  const refreshHandoff = await readFile(rloginTemplatePath, "utf8");
  assert.match(refreshHandoff, /http-equiv="refresh" content="0;url=\$\(link-login-only\)"/);

  const reseller = await readFile(resellerRoutePath, "utf8");
  assert.doesNotMatch(reseller, /allowPackagesDuringMaintenance/);
});

test("come3 refresh handoff matches the forest-pulse portal while keeping its redirect", async () => {
  const refreshHandoff = await readFile(rloginTemplatePath, "utf8");
  for (const token of [
    "--portal-accent:#16a34a",
    "--portal-accent-dark:#0f766e",
    "--portal-bg:#21180d",
    "--portal-bg2:#713f12",
    "rgba(8,35,20,.93)",
    "rgba(74,222,128,.25)",
  ]) {
    assert.ok(refreshHandoff.includes(token), `refresh handoff should include ${token}`);
  }
  assert.match(refreshHandoff, /ZOMBII ZOMBII/);
  assert.match(refreshHandoff, /http-equiv="refresh" content="0;url=\$\(link-login-only\)"/);
  assert.match(refreshHandoff, /href="\$\(link-login-only\)"/);
  assert.doesNotMatch(refreshHandoff, /function sendStk\(/);
});

test("default reseller portal deployment embeds the assigned router and port scope", async () => {
  const source = await readFile(resellerRoutePath, "utf8");
  const deployStart = source.indexOf("async function deployDefaultResellerPortalFile");
  const provisionStart = source.indexOf("async function provisionVlanResellerServices");
  assert.ok(deployStart >= 0 && provisionStart > deployStart, "default reseller portal deployment is present");
  const deploy = source.slice(deployStart, provisionStart);
  const provision = source.slice(provisionStart);

  assert.match(deploy, /window\\.__HOTSPOT_CONFIG__/);
  assert.match(deploy, /adminId: scope\.adminId/);
  assert.match(deploy, /resellerId: scope\.resellerId/);
  assert.match(deploy, /routerId: scope\.routerId/);
  assert.match(deploy, /portId: scope\.portId/);
  assert.match(deploy, /portalContextToken:\s*generateVlanHotspotPortalContextToken/);
  assert.match(deploy, /const sourceNameForContent = sourceName/);
  assert.match(deploy, /addVlanIdentityToRlogin/);
  assert.match(deploy, /overwrite: allowHotspotReplace/);
  assert.match(deploy, /RouterFileExistsError/);
  assert.match(provision, /admin_id=eq\.\$\{port\.admin_id\}&router_id=eq\.\$\{port\.router_id\}&port_id=eq\.\$\{port\.id\}/);

  const login = await readFile(new URL("../../ochola-supernet/src/pages/portal/HotspotLogin.tsx", import.meta.url), "utf8");
  assert.match(login, /portalContextToken/);
  assert.match(login, /X-Hotspot-Portal-Context/);
  assert.match(login, /X-Hotspot-NAS-Identifier/);
  assert.match(login, /X-Hotspot-Server-Name/);

  const routerPortal = await readFile(new URL("../../ochola-supernet/public/hotspot/login.html", import.meta.url), "utf8");
  assert.match(routerPortal, /\$\(identity\)/);
  assert.match(routerPortal, /\$\(server-name\)/);
  assert.match(routerPortal, /X-Hotspot-NAS-Identifier/);
  assert.match(routerPortal, /X-Hotspot-Server-Name/);
});

test("hotspot checkout carries and validates the service scope", async () => {
  const route = await readFile(mpesaRoutePath, "utf8");
  const portal = await readFile(templatePath, "utf8");
  assert.match(route, /planMatchesHotspotPortalScope/);
  assert.match(route, /The selected package does not belong to this hotspot service/);
  assert.match(route, /intent\.portId.*portalPortId/);
  assert.match(portal, /router_id:PORTAL_ROUTER_ID/);
  assert.match(portal, /port_id:PORTAL_PORT_ID/);
});