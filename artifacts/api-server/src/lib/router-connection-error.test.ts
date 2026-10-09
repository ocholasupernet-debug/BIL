import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatRouterConnectionError,
  isRouterApiTransportFailure,
} from "./router-connection-error.js";

test("a RouterOS API timeout points to the VPN path before suggesting firewall changes", () => {
  const message = formatRouterConnectionError(
    "10.8.5.16",
    new Error("Timed out after 6 seconds"),
  );

  assert.match(message, /no TCP response/i);
  assert.match(message, /management VPN/i);
  assert.match(message, /current tunnel IP/i);
  assert.match(message, /Do not add a firewall rule/i);
  assert.doesNotMatch(message, /\/ip firewall filter add|enable "api"/i);
});

test("a refused TCP connection points to the RouterOS API service", () => {
  const message = formatRouterConnectionError(
    "10.8.5.16",
    new Error("connect ECONNREFUSED"),
  );

  assert.match(message, /refused/i);
  assert.match(message, /API is enabled/i);
  assert.match(message, /allowed-address/i);
});

test("only transport failures skip a second username attempt", () => {
  assert.equal(isRouterApiTransportFailure(new Error("Timed out after 6 seconds")), true);
  assert.equal(isRouterApiTransportFailure(new Error("connect ECONNREFUSED")), true);
  assert.equal(isRouterApiTransportFailure(new Error("failure: invalid username or password")), false);
});
