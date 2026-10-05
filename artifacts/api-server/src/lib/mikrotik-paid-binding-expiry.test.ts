import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { RouterOSAPI } from "node-routeros";
import { getPaidHotspotBindingSnapshot } from "./mikrotik.js";

type MockRows = Record<string, string>[];
type MockCommand = string[];

async function withMockRouterApi<T>(
  respond: (command: MockCommand) => MockRows,
  run: (port: number) => Promise<T>,
): Promise<T> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not start the mock RouterOS API listener.");
  }

  const originalConnect = RouterOSAPI.prototype.connect;
  const originalWrite = RouterOSAPI.prototype.write;
  const originalClose = RouterOSAPI.prototype.close;
  RouterOSAPI.prototype.connect = async function () {
    this.connected = true;
    return this;
  };
  RouterOSAPI.prototype.write = async function (params, ...moreParams) {
    const command = Array.isArray(params)
      ? params
      : [params, ...moreParams.flatMap(value => Array.isArray(value) ? value : [value])];
    return respond(command);
  };
  RouterOSAPI.prototype.close = async function () {
    this.connected = false;
    return this;
  };

  try {
    return await run(address.port);
  } finally {
    RouterOSAPI.prototype.connect = originalConnect;
    RouterOSAPI.prototype.write = originalWrite;
    RouterOSAPI.prototype.close = originalClose;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

function credentials(port: number) {
  return {
    host: "127.0.0.1",
    port,
    username: "admin",
    password: "test-password",
    connectTimeoutMs: 1_000,
    requestTimeoutMs: 1_000,
  };
}

test("only snapshots a customer binding with its app-owned expiry scheduler", async () => {
  await withMockRouterApi(command => {
    if (command[0] === "/ip/hotspot/ip-binding/print") {
      return [{
        ".id": "*1",
        "mac-address": "AA:BB:CC:DD:EE:FF",
        address: "192.168.10.25",
        comment: "user-123",
        type: "regular",
      }];
    }
    if (command[0] === "/system/scheduler/print") {
      return [{
        name: "ochola-paid-user-123",
        comment: "OcholaSupernet paid access expiry",
      }];
    }
    return [];
  }, async port => {
    const snapshot = await getPaidHotspotBindingSnapshot(credentials(port), {
      name: "user-123",
      macAddress: "AA:BB:CC:DD:EE:FF",
    });
    assert.deepEqual(snapshot, {
      macAddress: "AA:BB:CC:DD:EE:FF",
      ipAddress: "192.168.10.25",
      comment: "user-123",
      bindingType: "regular",
    });
  });
});

test("does not claim an administrator binding without the managed expiry scheduler", async () => {
  await withMockRouterApi(command => {
    if (command[0] === "/ip/hotspot/ip-binding/print") {
      return [{
        ".id": "*1",
        "mac-address": "AA:BB:CC:DD:EE:FF",
        address: "192.168.10.25",
        comment: "user-123",
        type: "bypassed",
      }];
    }
    if (command[0] === "/system/scheduler/print") return [];
    return [];
  }, async port => {
    const snapshot = await getPaidHotspotBindingSnapshot(credentials(port), {
      name: "user-123",
      macAddress: "AA:BB:CC:DD:EE:FF",
    });
    assert.equal(snapshot, null);
  });
});
