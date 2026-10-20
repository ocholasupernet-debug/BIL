import assert from "node:assert/strict";
import test from "node:test";
import { planWritePayload } from "./plan-write.js";

const scope = { routerId: 7, portId: null };
const pools = { activeIpPool: null, expiredIpPool: null };

test("Hotspot plans default to tethering blocked in stored policy", () => {
  const payload = planWritePayload({ type: "hotspot", price: 100 }, scope, pools);
  assert.equal(payload.tethering_allowed, false);
});

test("Hotspot plans can explicitly allow tethering", () => {
  const payload = planWritePayload({
    type: "hotspot",
    price: 100,
    tetheringAllowed: true,
  }, scope, pools);
  assert.equal(payload.tethering_allowed, true);
});

test("non-Hotspot plans cannot enable the Hotspot tethering policy", () => {
  const payload = planWritePayload({
    type: "pppoe",
    price: 100,
    tetheringAllowed: true,
  }, scope, pools);
  assert.equal(payload.tethering_allowed, false);
});
