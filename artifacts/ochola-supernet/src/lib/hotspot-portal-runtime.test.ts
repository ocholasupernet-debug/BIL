import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portalTemplate = readFileSync(
  new URL("../../public/hotspot/login.html", import.meta.url),
  "utf8",
);
const reactPortal = readFileSync(
  new URL("../pages/portal/HotspotLogin.tsx", import.meta.url),
  "utf8",
);

test("the standalone portal applies background and package shape from typography settings", () => {
  const typographyHandler = portalTemplate.match(/function applyPortalTypography\(data\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(typographyHandler, /applyPortalBackground\(data\.portalBackground\)/);
  assert.match(typographyHandler, /normalisePortalPackageShape\(data\.portalPackageShape\)/);
  assert.match(portalTemplate, /style\.setProperty\("background",backgrounds\[PORTAL_BACKGROUND\],"important"\)/);
});

test("the generated standalone portal embeds its saved layout without a router-side stylesheet request", () => {
  const exporter = readFileSync(
    new URL("../pages/admin/HotspotSettings.tsx", import.meta.url),
    "utf8",
  );
  assert.match(portalTemplate, /data-portal-layout="classic"/);
  assert.match(exporter, /const layoutCss = renderStaticPortalLayoutCss\(config\.portalLayout\)/);
  assert.match(exporter, /<style id="hotspot-portal-layout">/);
  assert.match(exporter, /document\.documentElement\.setAttribute\("data-portal-layout",window\.__HOTSPOT_CONFIG__\.portalLayout\)/);
  assert.doesNotMatch(portalTemplate, /<link[^>]+portal-layouts\.css/);
});

test("the standalone portal applies the saved ISP or reseller name as soon as branding loads", () => {
  const brandingHandler = portalTemplate.match(/function applyPublicHotspotBranding\(brandingData\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const loader = portalTemplate.match(/function loadPortalTypography\(done\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(brandingHandler, /brandingData&&brandingData\.branding&&brandingData\.branding\.settings/);
  assert.match(brandingHandler, /applyPortalConfig\(merged\)/);
  assert.match(loader, /var brandingRequest=brandingUrl\?fetch/);
  assert.match(loader, /applyPublicHotspotBranding\(data\);return data;/);
  assert.match(portalTemplate, /if\(token\)headers\.set\("X-Hotspot-Portal-Context",token\)/);
});

test("the standalone RouterOS portal shows a configurable loyalty balance card", () => {
  assert.match(portalTemplate, /id="loyaltyPointsSection"/);
  assert.match(portalTemplate, /loyalty:true/);
  assert.match(portalTemplate, /function applyPortalLoyaltyCardSettings\(value\)/);
  assert.match(portalTemplate, /applyPortalLoyaltyCardSettings\(data\.loyaltyCard\)/);
  assert.match(portalTemplate, /\/api\/hotspot\/loyalty\/balance/);
  assert.match(portalTemplate, /\/api\/hotspot\/loyalty\/quote/);
  assert.match(portalTemplate, /\/api\/hotspot\/loyalty\/redeem/);
  assert.match(portalTemplate, /idempotency_key/);
  assert.doesNotMatch(portalTemplate, /id="loyaltyPhone"/);
  assert.match(portalTemplate, /position:"bottom",treatment:"filled",shape:"rounded",size:"standard"/);
});

test("voucher redemption in the standalone portal records a prepaid account before router login", () => {
  assert.match(portalTemplate, /id="voucherPhone" type="tel"/);
  assert.match(portalTemplate, /contact:phone/);
  assert.match(portalTemplate, /\/api\/vouchers\/hotspot\/redeem/);
  assert.match(portalTemplate, /function connectRedeemedVoucher\(\)/);
  assert.match(portalTemplate, /\/api\/customers\/hotspot-login/);
  assert.doesNotMatch(portalTemplate, /voucherPassHidden/);
  assert.doesNotMatch(portalTemplate, /name="sendin3" id="voucherForm" action=/);
});

test("RouterOS login keeps its login action and uses the configured tenant hostname after authentication", () => {
  const exporter = readFileSync(
    new URL("../pages/admin/HotspotSettings.tsx", import.meta.url),
    "utf8",
  );
  const loginHandler = portalTemplate.match(/function doLogin\(form\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(portalTemplate, /action="\$\(link-login-only\)"/);
  assert.match(portalTemplate, /name="dst"\s+value="\$\(link-orig\)"/);
  assert.match(exporter, /postLoginUrl: hotspotPostLoginDestination\(settings\.portalHostname, PUBLIC_BASE_DOMAIN\)/);
  assert.match(loginHandler, /configuredPostLoginDestination\(\)/);
  assert.match(loginHandler, /dstField\.value=postLoginDestination/);
  assert.match(portalTemplate, /if\(typeof doLogin==="function"&&doLogin\(form\)\)form\.submit\(\)/);
});

test("the captive portal reconnects a valid device session and keeps payment handoff separate", () => {
  assert.match(portalTemplate, /PORTAL_AUTO_RECONNECT_MAX_ATTEMPTS=10/);
  assert.match(portalTemplate, /PORTAL_AUTO_RECONNECT_WINDOW_MS=120000/);
  assert.match(portalTemplate, /function portalAutoReconnectCanRetry\(\)/);
  assert.match(portalTemplate, /Math\.min\(1000\*Math\.pow\(2,Math\.min\(Math\.max\(portalAutoReconnectAttempts-1,0\),4\)\),10000\)/);
  assert.match(portalTemplate, /function attemptPortalAutoReconnect\(\)/);
  assert.match(portalTemplate, /action:"login"/);
  assert.match(portalTemplate, /router_id:PORTAL_ROUTER_ID/);
  assert.match(portalTemplate, /port_id:PORTAL_PORT_ID/);
  assert.match(portalTemplate, /data\.connected===true/);
  assert.match(portalTemplate, /window\.addEventListener\("online",retryPortalAutoReconnectOnReturn\)/);
  assert.match(portalTemplate, /if\(!portalPaidHandoffStarted\)attemptPortalAutoReconnect\(\)/);
  assert.match(portalTemplate, /data\.status==="expired"\|\|data\.status==="depleted"/);
});

test("TV reconnect retries the existing paid checkout while package checking remains diagnostic-only", () => {
  assert.match(reactPortal, /const retryExistingPaidAccess = useCallback\(\(\) => \{\s*if \(!checkoutId \|\| bindingInFlight\.current\) return;[\s\S]*?bindPaidHotspotAccess\(checkoutId, true\);/);
  assert.match(reactPortal, /Reconnect this TV/);
  assert.match(reactPortal, /Reconnect uses the same paid package; no new purchase is made\./);
  assert.match(reactPortal, /onClick=\{retryExistingPaidAccess\}/);
  assert.match(reactPortal, /onClick=\{\(\) => void checkTvPackageStatus\(\)\}/);
  assert.doesNotMatch(reactPortal, /if \(isTvMode && \(tvDiagnostic\?\.status === "device_not_seen"[\s\S]*?void checkTvPackageStatus\(\);/);
});

test("already-paid links open troubleshooting and immediately request the existing sign-in check", () => {
  const staticTroubleshootOpener = portalTemplate.match(/function openTroubleshootModule\(\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(portalTemplate, /id="alreadyPaidReconnect"[^>]+onclick="openTroubleshootModule\(\);return false"/);
  assert.match(staticTroubleshootOpener, /troubleshootConnection\(true\)/);
  assert.match(reactPortal, /className="hp-header-reconnect"/);
  assert.match(reactPortal, /Already paid\?/);
  assert.match(reactPortal, /const openAlreadyPaidReconnect = \(\) => \{\s*setTroubleshootDialogOpen\(true\);\s*void handleTroubleshoot\(\);\s*\}/);
  assert.match(reactPortal, /aria-controls="hp-troubleshoot-dialog"/);
  assert.match(reactPortal, /\{troubleshootDialogOpen && \(/);
  assert.match(reactPortal, /const runAutomaticReconnect = async \(\) =>/);
  assert.match(reactPortal, /result = await requestHotspotTroubleshoot\("login"\)/);
});