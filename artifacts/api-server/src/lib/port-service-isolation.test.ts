import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPortServiceBridgeIsolated,
  assertPortServiceDnsEntriesOwned,
  assertPortServiceHostnamesIsolated,
} from "./port-service-isolation.js";

test("a port service cannot reuse an existing bridge it does not own", () => {
  assert.throws(
    () => assertPortServiceBridgeIsolated("hotspot-bridge", "port8_bridge", [
      { name: "hotspot-bridge", comment: "main Hotspot LAN" },
    ]),
    /normal Hotspot bridge cannot be reused/,
  );
});

test("an already-created bridge owned by this port service remains reusable", () => {
  assert.doesNotThrow(() => assertPortServiceBridgeIsolated("port8-bridge", "port8_bridge", [
    { name: "port8-bridge", comment: "port8_bridge" },
  ]));
});

test("service DNS names cannot collide with the main portal hostname or origin", () => {
  assert.throws(
    () => assertPortServiceHostnamesIsolated(
      ["isp.example.test"],
      ["ISP.example.test", "app.example.test"],
    ),
    /already used by the main Hotspot/,
  );
});

test("an isolated service cannot claim another RouterOS service's DNS entry", () => {
  assert.throws(
    () => assertPortServiceDnsEntriesOwned(["port.example.test"], ["port8_hotspot_dns"], [
      { name: "port.example.test", comment: "main_hotspot_dns" },
    ]),
    /belongs to another service/,
  );
  assert.doesNotThrow(() => assertPortServiceDnsEntriesOwned(["port.example.test"], ["port8_hotspot_dns"], [
    { name: "port.example.test", comment: "port8_hotspot_dns" },
  ]));
});
