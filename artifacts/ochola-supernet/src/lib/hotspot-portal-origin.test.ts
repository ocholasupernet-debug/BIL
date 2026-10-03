import assert from "node:assert/strict";
import test from "node:test";
import { hotspotPortalApiOrigin } from "./hotspot-portal-origin.js";

test("custom portal hostnames become HTTPS API origins", () => {
  assert.equal(
    hotspotPortalApiOrigin("ocholasupernet.com", "https://come.isplatty.org/", "isplatty.org"),
    "https://ocholasupernet.com",
  );
});

test("existing tenant-style portal labels keep the default base domain", () => {
  assert.equal(
    hotspotPortalApiOrigin("come", "https://other.isplatty.org", "isplatty.org"),
    "https://come.isplatty.org",
  );
  assert.equal(
    hotspotPortalApiOrigin("admin", "https://other.isplatty.org", "isplatty.org"),
    "https://isplatty.org",
  );
});

test("an empty custom hostname preserves the existing API origin", () => {
  assert.equal(
    hotspotPortalApiOrigin("", "https://come.isplatty.org/", "isplatty.org"),
    "https://come.isplatty.org",
  );
});

test("invalid or local portal hostnames are rejected", () => {
  for (const hostname of [
    "https://ocholasupernet.com",
    "wifi.example.com/path",
    "bad..example.com",
    "localhost",
    "192.168.1.2",
  ]) {
    assert.throws(
      () => hotspotPortalApiOrigin(hostname, "https://come.isplatty.org", "isplatty.org"),
      /valid DNS hostname|public DNS hostname/,
      hostname,
    );
  }
});