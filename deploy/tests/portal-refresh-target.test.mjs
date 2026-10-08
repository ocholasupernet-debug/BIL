import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveRouterIdByExactName,
  resolveTenantRouterTargets,
  isNoActiveHotspotServerResponse,
  resolvePortalBridgeSelection,
  resolveTenantApiOrigin,
  validateExpectedRouterName,
} from "../portal-refresh-target.mjs";

test("builds the API origin from the exact tenant subdomain", () => {
  assert.equal(resolveTenantApiOrigin("OcholaSuperNet"), "https://ocholasupernet.isplatty.org");
});

test("rejects invalid tenant subdomains rather than calling a different tenant host", () => {
  assert.throws(() => resolveTenantApiOrigin("come.example"), /exact valid tenant subdomain/);
  assert.throws(() => resolveTenantApiOrigin(".."), /exact valid tenant subdomain/);
});

test("selects the chosen Hotspot bridge and pins the exact router", () => {
  assert.deepEqual(
    resolvePortalBridgeSelection("ocholasupernet2", "hotspot-bridge"),
    { bridgeName: "hotspot-bridge", expectedRouterName: "ocholasupernet2" },
  );
});

test("keeps automatic selection only for targets without an explicit bridge", () => {
  assert.deepEqual(
    resolvePortalBridgeSelection("ocholasupernet2", null),
    { autoSelectBridgeServer: true, expectedRouterName: "ocholasupernet2" },
  );
  assert.deepEqual(
    resolvePortalBridgeSelection(null, null),
    { bridgeName: "co-hotspot-bridge" },
  );
});

test("resolves the exact tenant router name rather than reusing a stale numeric ID", () => {
  const routers = [
    { id: 85, name: "come1" },
    { id: 112, name: "come3" },
    { id: 113, name: "Come3" },
  ];

  assert.equal(resolveRouterIdByExactName(routers, "come3"), 112);
});

test("fails closed when the exact tenant router name is absent or ambiguous", () => {
  assert.throws(
    () => resolveRouterIdByExactName([{ id: 85, name: "come1" }], "come3"),
    /No tenant router has the exact name come3/,
  );
  assert.throws(
    () => resolveRouterIdByExactName([{ id: 112, name: "come3" }, { id: 113, name: "come3" }], "come3"),
    /More than one tenant router has the exact name come3/,
  );
});

test("rejects router names that could alter the API path", () => {
  assert.throws(() => validateExpectedRouterName("../come3"), /exact valid stored name/);
});

test("resolves every tenant router once in a stable order", () => {
  assert.deepEqual(
    resolveTenantRouterTargets([
      { id: 85, name: "come3" },
      { id: "4", name: "come1" },
    ]),
    [
      { id: 4, name: "come1" },
      { id: 85, name: "come3" },
    ],
  );
});

test("fails closed on malformed or ambiguous all-router targets", () => {
  assert.throws(() => resolveTenantRouterTargets({}), /router list response was invalid/);
  assert.throws(() => resolveTenantRouterTargets([{ id: true, name: "come1" }]), /invalid router ID/);
  assert.throws(
    () => resolveTenantRouterTargets([{ id: 1, name: "come1" }, { id: 1, name: "come2" }]),
    /duplicate router IDs or names/,
  );
  assert.throws(
    () => resolveTenantRouterTargets([{ id: 1, name: "come1" }, { id: 2, name: "come1" }]),
    /duplicate router IDs or names/,
  );
  assert.throws(
    () => resolveTenantRouterTargets([{ id: 1, name: "router name with spaces" }]),
    /exact valid stored name/,
  );
});

test("only skips routers explicitly reported to have no active Hotspot server", () => {
  const response = {
    error: "No active Hotspot server is available for automatic selection; no files were changed.",
    availableHotspotServers: [],
  };
  assert.equal(isNoActiveHotspotServerResponse(409, response), true);
  assert.equal(isNoActiveHotspotServerResponse(409, { ...response, availableHotspotServers: [{ name: "hs1" }] }), false);
  assert.equal(isNoActiveHotspotServerResponse(503, response), false);
  assert.equal(isNoActiveHotspotServerResponse(409, { ...response, error: "Router connection failed" }), false);
});