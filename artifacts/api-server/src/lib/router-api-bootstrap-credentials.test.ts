import assert from "node:assert/strict";
import test from "node:test";
import { ROUTER_MANAGEMENT_API_USERNAME } from "./router-management-vpn.js";
import { resolveRouterApiCredentialsForCreate } from "./router-api-bootstrap-credentials.js";

test("generates a unique API secret and management username when adding a script-installed router", () => {
  const first = resolveRouterApiCredentialsForCreate({ routerName: "come7" });
  const second = resolveRouterApiCredentialsForCreate({ routerName: "come8" });

  assert.equal(first.username, ROUTER_MANAGEMENT_API_USERNAME);
  assert.equal(first.generated, true);
  assert.match(first.password, /^[a-f0-9]{64}$/);
  assert.notEqual(first.password, second.password);
  assert.notEqual(first.password, "come7");
});

test("preserves explicitly supplied credentials for an existing router import", () => {
  const result = resolveRouterApiCredentialsForCreate({
    routerName: "come7",
    username: "legacy-router-user",
    password: "an-existing-working-password",
  });

  assert.deepEqual(result, {
    username: "legacy-router-user",
    password: "an-existing-working-password",
    generated: false,
  });
});

test("uses the management API username for an automatically generated password", () => {
  const result = resolveRouterApiCredentialsForCreate({
    routerName: "come7",
    username: "",
    password: "",
  });

  assert.equal(result.username, ROUTER_MANAGEMENT_API_USERNAME);
  assert.equal(result.generated, true);
  assert.match(result.password, /^[a-f0-9]{64}$/);
});
