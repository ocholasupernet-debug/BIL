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

test("separate routing keeps bank-transfer details service-specific but not checkout-ready", () => {
  const status = routing.publicServiceStatus(
    "separate",
    "mpesa_paybill",
    {},
    {
      hotspot: { gatewayId: "mpesa_till_push", config: { tillNumber: "998877" } },
      pppoe: {
        gatewayId: "bank_transfer",
        config: {
          bankName: "KCB",
          accountName: "Ochola Supernet",
          accountNumber: "1234567890",
          branchCode: "001",
        },
      },
    },
  );
  assert.equal(status.hotspot.gatewayId, "mpesa_till_push");
  assert.equal(status.hotspot.configured, true);
  assert.equal(status.pppoe.gatewayId, "bank_transfer");
  assert.equal(status.pppoe.configured, false);
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

  const vlanIntent = auth.generatePaymentIntent({
    adminId: 7,
    planId: 23,
    amount: 1800,
    phone: "254712345678",
    serviceType: "vlan",
    customerId: 102,
    routerId: 5,
    portId: 9,
  });
  const vlanPayload = auth.validatePaymentIntent(vlanIntent);
  assert.equal(vlanPayload.serviceType, "vlan");
  assert.equal(vlanPayload.customerId, 102);
  assert.equal(vlanPayload.routerId, 5);
  assert.equal(vlanPayload.portId, 9);
});

test("incomplete or unsupported service configurations are not checkout-ready", () => {
  assert.equal(routing.isGatewayConfigComplete("mpesa_paybill", { paybillNumber: "123456" }), false);
  assert.equal(routing.isGatewayConfigComplete("bank_stk_push", { bankName: "KCB", paybillNumber: "123456" }), false);
  assert.equal(routing.isGatewayConfigComplete("bank_transfer", {
    bankName: "KCB",
    accountName: "Ochola Supernet",
    accountNumber: "1234567890",
  }), true);
  assert.equal(routing.isGatewayCheckoutReady("bank_transfer", {
    bankName: "KCB",
    accountName: "Ochola Supernet",
    accountNumber: "1234567890",
  }), false);
  assert.equal(routing.isGatewayConfigComplete("stripe", { secretKey: "present" }), false);
  assert.equal(routing.isGatewayCheckoutReady("stripe", { secretKey: "present" }), false);
  assert.equal(routing.isDarajaGateway("bank_stk_push"), true);
  assert.equal(routing.isDarajaGateway("bank_transfer"), false);
});

test("setup-only gateways can be selected per service without becoming checkout-ready", () => {
  const services = routing.servicePaymentConfigMap({
    hotspot: { gatewayId: "airtel", config: { clientSecret: "must-not-leak" } },
    pppoe: { gatewayId: "bank_transfer", config: { bankName: "KCB", accountName: "ISP", accountNumber: "123456" } },
  });
  assert.equal(services.hotspot.gatewayId, "airtel");
  assert.deepEqual(services.hotspot.config, {});

  const status = routing.publicServiceStatus("separate", "mpesa_paybill", {}, services);
  assert.equal(status.hotspot.gatewayId, "airtel");
  assert.equal(status.hotspot.configured, false);
  assert.equal(status.pppoe.gatewayId, "bank_transfer");
  assert.equal(status.pppoe.configured, false);
});

test("bank transfer account routing keeps only safe collection details", () => {
  assert.deepEqual(
    routing.collectionConfig("bank_transfer", {
      bankName: "KCB",
      accountName: "Ochola Supernet",
      accountNumber: "1234567890",
      branchCode: "001",
      paymentInstructions: "Use your PPPoE username as reference",
      apiSecret: "must-not-leak",
    }),
    {
      bankName: "KCB",
      accountName: "Ochola Supernet",
      accountNumber: "1234567890",
      branchCode: "001",
      paymentInstructions: "Use your PPPoE username as reference",
    },
  );
});

test("service routing strips fields that are not collection destinations", () => {
  assert.deepEqual(
    routing.collectionConfig("mpesa_paybill", { paybillNumber: "123456", accountNumber: "ISP", clientSecret: "must-not-leak" }),
    { paybillNumber: "123456", accountNumber: "ISP" },
  );
});

test("service routing accepts legacy PayBill destination field names", () => {
  assert.deepEqual(
    routing.collectionConfig("mpesa_paybill", {
      merchantIdentifier: "123456",
      accountReference: "ISP",
      clientSecret: "must-not-leak",
    }),
    { paybillNumber: "123456", accountNumber: "ISP" },
  );
});