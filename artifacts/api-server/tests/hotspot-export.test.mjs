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
const mikrotikRoutePath = resolve(apiRoot, "src/routes/mikrotik-route.ts");

async function loadExportBuilder() {
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
              export function getSelectedTenantId() { return 7; }
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
    freeTrial: "Enable",
    vouchers: "Yes",
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
    throw new Error(`unexpected export request: ${raw}`);
  };

  try {
    const html = await builder.buildPortalHtml(stagingSettings(), "tenant");
    for (const macro of [
      "$(link-login-only)",
      "$(link-orig)",
      "$(if error)",
      "$(endif error)",
      "$(username)",
    ]) assert.match(html, new RegExp(`\\$\\(${macro.slice(2, -1)}\\)`));
    assert.match(html, /name="password" type="password"/);
    assert.match(html, /<script src="\/hotspot\/md5\.js"><\/script>/);
    assert.match(html, /Acme &lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>alert\('x'\)<\/script>/);

    const configMatch = html.match(/window\.__HOTSPOT_CONFIG__=(.*);<\/script>/);
    assert.ok(configMatch, "generated config bootstrap is present");
    const config = JSON.parse(configMatch[1]);
    assert.equal(config.apiBase, "https://tenant.example.test");
    assert.equal(config.ispName, stagingSettings().ispName);
    assert.equal(config.freeTrialEnabled, true);
    assert.equal(config.vouchersEnabled, true);
    for (const key of [
      "routerId",
      "routerSecret",
      "routerPassword",
      "paymentSecret",
      "sessionSecret",
      "vpnPrivateKey",
    ]) assert.equal(config[key], undefined, `${key} must not be embedded in portal config`);

    for (const value of sensitiveFixtures) assert.doesNotMatch(html, new RegExp(value));
    assert.equal(calls.length, 2);
    assert.ok(calls.every(url => !/\/api\/admin|\/router|\/sync|\/upload/i.test(url)));
  } finally {
    globalThis.fetch = realFetch;
    await builder.cleanup();
  }
});

test("invalid or internal API origins fall back to the public tenant HTTPS origin", async () => {
  const template = await readFile(templatePath, "utf8");
  const builder = await loadExportBuilder();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input), "https://tenant.example.test");
    if (url.pathname === "/hotspot/login.html") return new Response(template, { status: 200 });
    return new Response(JSON.stringify({ apiBase: "http://localhost:8080" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const html = await builder.buildPortalHtml(stagingSettings(), "tenant");
    const configMatch = html.match(/window\.__HOTSPOT_CONFIG__=(.*);<\/script>/);
    const config = JSON.parse(configMatch[1]);
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

  assert.equal((deployActions.match(/window\.confirm/g) ?? []).length, 2);
  assert.match(deployActions, /hotspot-portal\/deploy/);
  assert.match(deployActions, /deploy\(false\)/);
  assert.match(deployActions, /deploy\(true\)/);
  assert.match(deployActions, /status === 409/);
  assert.match(deployActions, /JSON\.stringify\(\{ adminId, html, overwrite \}\)/);
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