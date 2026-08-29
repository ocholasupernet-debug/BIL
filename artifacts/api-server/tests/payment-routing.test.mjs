import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { rm } from "node:fs/promises";
import path from "node:path";

process.env.TOKEN_SIGNING_SECRET = "payment-routing-test-secret";
const outdir = "tests/.payment-routing-build";
await build({
  entryPoints: ["src/lib/payment-routing.ts", "src/lib/api-auth.ts"],
  outdir,
  bundle: true,
  platform: "node",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  logLevel: "silent",
});
const routing = await import(path.resolve(outdir, "payment-routing.cjs"));
const auth = await import(path.resolve(outdir, "api-auth.cjs"));
await rm(outdir, { recursive: true, force: true });

test("shared routing reports one configured destination for both services", () => {
  const status = routing.publicServiceStatus(
    "shared",
    "mpesa_paybill",
    { paybillNumber: "123456", accountNumber: "ISP" },
    {},
  );
  assert.equal(status.hotspot.gatewayId, "mpesa_paybill");
  assert.equal(status.pppoe.gatewayId, "mpesa_paybill");
  assert.equal(status.hotspot.configured, true);
  assert.equal(status.pppoe.configured, true);
});

test("separate routing keeps service destinations isolated", () => {
  const status = routing.publicServiceStatus(
    "separate",
    "mpesa_paybill",
    {},
    {
      hotspot: { gatewayId: "mpesa_till_push", config: { tillNumber: "998877" } },
      pppoe: { gatewayId: "bank_stk_push", config: { bankName: "KCB Bank", paybillNumber: "445566", accountNumber: "PPPOE" } },
    },
  );
  assert.equal(status.hotspot.gatewayId, "mpesa_till_push");
  assert.equal(status.hotspot.configured, true);
  assert.equal(status.pppoe.gatewayId, "bank_stk_push");
  assert.equal(status.pppoe.configured, true);
  assert.equal(routing.isGatewayConfigComplete("mpesa_till_push", { tillNumber: "" }), false);
});

test("payment intents bind PPPoE customer and service and reject tampering", () => {
  const intent = auth.generatePaymentIntent({
    adminId: 7,
    planId: 22,
    amount: 1500,
    phone: "254712345678",
    serviceType: "pppoe",
    customerId: 101,
  });
  const payload = auth.validatePaymentIntent(intent);
  assert.equal(payload.serviceType, "pppoe");
  assert.equal(payload.customerId, 101);
  assert.equal(auth.validatePaymentIntent(`${intent}tampered`), null);
});

test("incomplete or unsupported service configurations are not checkout-ready", () => {
  assert.equal(routing.isGatewayConfigComplete("mpesa_paybill", { paybillNumber: "123456" }), false);
  assert.equal(routing.isGatewayConfigComplete("bank_stk_push", { bankName: "KCB", paybillNumber: "123456" }), false);
  assert.equal(routing.isGatewayConfigComplete("stripe", { secretKey: "present" }), false);
});

test("service routing strips fields that are not collection destinations", () => {
  assert.deepEqual(
    routing.collectionConfig("mpesa_paybill", { paybillNumber: "123456", accountNumber: "ISP", clientSecret: "must-not-leak" }),
    { paybillNumber: "123456", accountNumber: "ISP" },
  );
});