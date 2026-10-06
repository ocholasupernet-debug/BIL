import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const portalTemplate = readFileSync(
  new URL("../../public/hotspot/login.html", import.meta.url),
  "utf8",
);

const marker = "Load the configured Tawk widget";
const markerIndex = portalTemplate.indexOf(marker);
const scriptStart = portalTemplate.lastIndexOf("<script>", markerIndex);
const scriptEnd = portalTemplate.indexOf("</script>", markerIndex);
const widgetScript = portalTemplate.slice(scriptStart + "<script>".length, scriptEnd);

function loadWidget(hostname: string, config: Record<string, unknown>) {
  let insertedScript: {
    src?: string;
    async?: boolean;
    charset?: string;
    attributes?: Record<string, string>;
  } | undefined;
  const firstScript = {
    parentNode: {
      insertBefore(script: typeof insertedScript) {
        insertedScript = script;
      },
    },
  };
  const document = {
    createElement() {
      return {
        attributes: {} as Record<string, string>,
        setAttribute(name: string, value: string) {
          this.attributes[name] = value;
        },
      };
    },
    getElementsByTagName() {
      return [firstScript];
    },
    head: {
      appendChild(script: typeof insertedScript) {
        insertedScript = script;
      },
    },
  };
  const window = {
    location: { hostname },
    __HOTSPOT_CONFIG__: config,
    Tawk_API: undefined as Record<string, unknown> | undefined,
    Tawk_LoadStart: undefined as Date | undefined,
  };

  vm.runInNewContext(widgetScript, { window, document, URL, Date, encodeURIComponent });
  return insertedScript;
}

test("Tawk loads asynchronously for the exact tenant, including RouterOS-served pages", () => {
  assert.ok(markerIndex > 0 && scriptStart >= 0 && scriptEnd > markerIndex);
  assert.ok(portalTemplate.includes('var targetHostname="ocholasupernet.isplatty.org"'));
  assert.ok(portalTemplate.includes('configuredApiBase.protocol==="https:"'));
  assert.ok(portalTemplate.includes("configuredTenantHostname===targetHostname"));
  assert.ok(scriptEnd < portalTemplate.lastIndexOf("</body>"));
  assert.ok(portalTemplate.lastIndexOf("</body>") - markerIndex < 1500);

  const onTenantDomain = loadWidget("ocholasupernet.isplatty.org", {
    apiBase: "https://other-tenant.isplatty.org",
    tawkEnabled: true,
  });
  assert.equal(onTenantDomain?.src, "https://embed.tawk.to/6ac4631c8fd05734c7457563/1k47i6apm");
  assert.equal(onTenantDomain?.async, true);
  assert.equal(onTenantDomain?.charset, "UTF-8");
  assert.equal(onTenantDomain?.attributes?.crossorigin, "*");

  const onRouterCaptivePage = loadWidget("192.168.88.1", {
    apiBase: "https://ocholasupernet.isplatty.org",
    tawkEnabled: true,
  });
  assert.equal(onRouterCaptivePage?.src, "https://embed.tawk.to/6ac4631c8fd05734c7457563/1k47i6apm");
});

test("Tawk stays off for another tenant, disabled settings, or a non-HTTPS tenant origin", () => {
  assert.equal(loadWidget("192.168.88.1", {
    apiBase: "https://other-tenant.isplatty.org",
    tawkEnabled: true,
  }), undefined);
  assert.equal(loadWidget("192.168.88.1", {
    apiBase: "https://ocholasupernet.isplatty.org",
    tawkEnabled: false,
  }), undefined);
  assert.equal(loadWidget("192.168.88.1", {
    apiBase: "http://ocholasupernet.isplatty.org",
    tawkEnabled: true,
  }), undefined);
});
