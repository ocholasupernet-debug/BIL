import assert from "node:assert/strict";
import test from "node:test";
import { routerApiTransport } from "./router-api-port.js";

test("uses plain RouterOS API for legacy and 8728 records", () => {
  assert.deepEqual(routerApiTransport(undefined), { port: 8728, useSSL: false });
  assert.deepEqual(routerApiTransport("8728"), { port: 8728, useSSL: false });
});

test("uses API-SSL for a saved 8729 port", () => {
  assert.deepEqual(routerApiTransport(8729), { port: 8729, useSSL: true });
});

test("does not pass unsupported saved ports to the RouterOS client", () => {
  assert.deepEqual(routerApiTransport(8727), { port: 8728, useSSL: false });
});
