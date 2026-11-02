import assert from "node:assert/strict";
import test from "node:test";
import { classifyInterfaceInventoryFailure } from "./router-load-balancing-route.js";

test("classifies authentication failures separately from transport failures", () => {
  assert.equal(classifyInterfaceInventoryFailure(new Error("Login failed")).code, "INVALID_CREDENTIALS");
  assert.equal(classifyInterfaceInventoryFailure(new Error("ETIMEDOUT")).code, "API_TIMEOUT");
});

test("reports read permission failures without calling them bad credentials", () => {
  const result = classifyInterfaceInventoryFailure(new Error("not enough permissions (read policy required)"));
  assert.equal(result.code, "API_PERMISSION_DENIED");
  assert.equal(result.status, 403);
});

test("identifies VPN, unavailable-port, and unsupported-command failures", () => {
  assert.equal(classifyInterfaceInventoryFailure(new Error("management API forward failed")).code, "VPN_CONNECTION_FAILED");
  assert.equal(classifyInterfaceInventoryFailure(new Error("connect ECONNREFUSED")).code, "API_PORT_UNREACHABLE");
  assert.equal(classifyInterfaceInventoryFailure(new Error("unknown command")).code, "ROUTER_VERSION_INCOMPATIBLE");
});
