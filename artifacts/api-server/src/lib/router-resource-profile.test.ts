import assert from "node:assert/strict";
import test from "node:test";
import {
  cachedRouterReadProfile,
  classifyRouterReadProfile,
  rememberRouterReadProfile,
  routerProfileCacheKey,
  shouldCacheRouterReadProfile,
} from "./router-resource-profile.js";

test("hAP Lite and RB941 hardware use the low-resource read profile", () => {
  assert.equal(classifyRouterReadProfile({ "board-name": "hAP lite" }), "low-resource");
  assert.equal(classifyRouterReadProfile({ model: "RB941-2nD" }), "low-resource");
});

test("low memory and single-core low-frequency routers use the low-resource profile", () => {
  assert.equal(classifyRouterReadProfile({ "total-memory": "33554432" }), "low-resource");
  assert.equal(classifyRouterReadProfile({ "total-memory": "32.0MiB" }), "low-resource");
  assert.equal(classifyRouterReadProfile({
    "cpu-count": "1",
    "cpu-frequency": "650MHz",
  }), "low-resource");
  assert.equal(classifyRouterReadProfile({
    "cpu-count": "1",
    "cpu-frequency": "0.65GHz",
  }), "low-resource");
});

test("higher-capacity routers keep the standard read profile", () => {
  assert.equal(classifyRouterReadProfile({
    "board-name": "CCR2004-16G-2S+",
    "total-memory": "1073741824",
    "cpu-count": "4",
    "cpu-frequency": "1700",
  }), "standard");
  assert.equal(classifyRouterReadProfile(undefined), "standard");
});

test("unknown hardware is not cached as a verified resource profile", () => {
  assert.equal(shouldCacheRouterReadProfile({ version: "6.49.16" }), false);
  assert.equal(shouldCacheRouterReadProfile({ "board-name": "hAP lite" }), true);
  assert.equal(shouldCacheRouterReadProfile({ "cpu-count": "1", "cpu-frequency": "650" }), true);
});

test("router read profiles are isolated by endpoint and expire", () => {
  const endpoint = { host: "Router.Example", port: 8728, bridgeIp: "10.8.5.16" };
  const key = routerProfileCacheKey(endpoint);
  assert.equal(key, routerProfileCacheKey({ ...endpoint, host: "router.example" }));

  rememberRouterReadProfile(key, "low-resource", 1_000);
  assert.equal(cachedRouterReadProfile(key, 1_001), "low-resource");
  assert.equal(cachedRouterReadProfile(`${key}|other`, 1_001), undefined);
  assert.equal(cachedRouterReadProfile(key, 6 * 60 * 60 * 1000 + 1_000), undefined);
});
