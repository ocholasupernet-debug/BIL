import assert from "node:assert/strict";
import test from "node:test";
import { buildManagedPppoeSetupScript } from "./pppoe-setup-script.js";

test("managed PPPoE setup targets the selected interface and includes access pools and WAN rules", () => {
  const script = buildManagedPppoeSetupScript({
    routerId: 243,
    interfaceName: "ether8",
    serviceName: "ochola-services-243-pppoe-port-ether8",
  });

  assert.match(script, /:local pppInterface "ether8";/);
  assert.match(script, /:local pppService "ochola-services-243-pppoe-port-ether8";/);
  assert.match(script, /192\.168\.99\.10-192\.168\.99\.254/);
  assert.match(script, /192\.168\.191\.10-192\.168\.191\.254/);
  assert.match(script, /pppoe-to-wan/);
  assert.match(script, /PPPoE masquerade/);
});

test("managed PPPoE setup rejects unsafe interface or service names", () => {
  assert.throws(() => buildManagedPppoeSetupScript({
    routerId: 243,
    interfaceName: 'ether1"; /system reboot',
    serviceName: "service",
  }), /RouterOS-safe/);
});
