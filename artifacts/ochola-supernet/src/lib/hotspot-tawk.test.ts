import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portalTemplate = readFileSync(
  new URL("../../public/hotspot/login.html", import.meta.url),
  "utf8",
);

test("Tawk.to is loaded asynchronously only on OcholaSupernet's exact portal hostname", () => {
  const marker = "Replace these public widget IDs";
  const markerIndex = portalTemplate.indexOf(marker);
  const scriptStart = portalTemplate.lastIndexOf("<script>", markerIndex);
  const scriptEnd = portalTemplate.indexOf("</script>", markerIndex);
  const widgetScript = portalTemplate.slice(scriptStart, scriptEnd);

  assert.ok(markerIndex > 0 && scriptStart >= 0 && scriptEnd > markerIndex);
  assert.ok(widgetScript.includes('if(window.location.hostname === "ocholasupernet.isplatty.org"){'));
  assert.ok(widgetScript.includes('var propertyId="6ac4631c8fd05734c7457563"'));
  assert.ok(widgetScript.includes('var widgetId="1k47i6apm"'));
  assert.ok(widgetScript.includes('if(propertyId==="YOUR_PROPERTY_ID"||widgetId==="YOUR_WIDGET_ID")return'));
  assert.ok(widgetScript.includes("tawkScript.async=true"));
  assert.ok(widgetScript.includes(
    'tawkScript.src="https://embed.tawk.to/"+encodeURIComponent(propertyId)+"/"+encodeURIComponent(widgetId)',
  ));
  assert.equal((portalTemplate.match(/https:\/\/embed\.tawk\.to\//g) ?? []).length, 1);
  assert.ok(scriptEnd < portalTemplate.lastIndexOf("</body>"));
  assert.ok(portalTemplate.lastIndexOf("</body>") - markerIndex < 1500);
});
