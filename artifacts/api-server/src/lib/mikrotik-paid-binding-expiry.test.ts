import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { RouterOSAPI } from "node-routeros";
import { getPaidHotspotBindingSnapshot, hasPaidHotspotAccess } from "./mikrotik.js";

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

test("snapshots an explicitly managed bypass binding with its expiry scheduler", async () => {
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
    if (command[0] === "/system/scheduler/print") {
      return [{
        name: "ochola-paid-user-123",
        comment: "OcholaSupernet paid access expiry",
        "on-event": ':foreach id in=[/ip hotspot ip-binding find where comment="user-123"] do={/ip hotspot ip-binding remove $id}; /ip hotspot active find where user="user-123"',
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
      bindingType: "bypassed",
    });
  });
});

test("allows an exact regular paid binding to be edited when its expiry scheduler is missing", async () => {
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
    if (command[0] === "/system/scheduler/print") return [];
    return [];
  }, async port => {
    const snapshot = await getPaidHotspotBindingSnapshot(credentials(port), {
      name: "user-123",
      macAddress: "AA:BB:CC:DD:EE:FF",
    });
    assert.equal(snapshot?.bindingType, "regular");
    assert.equal(snapshot?.comment, "user-123");
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
    assert.equal(await hasPaidHotspotAccess(credentials(port), {
      name: "user-123",
      macAddress: "AA:BB:CC:DD:EE:FF",
    }), false);
  });
});

test("recovers a missing binding from a matching app-owned expiry scheduler", async () => {
  await withMockRouterApi(command => {
    if (command[0] === "/ip/hotspot/ip-binding/print") return [];
    if (command[0] === "/system/scheduler/print") {
      return [{
        ".id": "*2",
        name: "ochola-paid-user-123",
        comment: "OcholaSupernet paid access expiry",
        "on-event": ':foreach id in=[/ip hotspot ip-binding find where comment="user-123"] do={/ip hotspot ip-binding remove $id}; /ip hotspot active find where user="user-123"',
      }];
    }
    return [];
  }, async port => {
    const snapshot = await getPaidHotspotBindingSnapshot(credentials(port), {
      name: "user-123",
      macAddress: "AA:BB:CC:DD:EE:FF",
      ipAddress: "192.168.10.25",
    });
    assert.deepEqual(snapshot, {
      macAddress: "AA:BB:CC:DD:EE:FF",
      ipAddress: null,
      comment: "user-123",
      bindingType: "regular",
    });
  });
});

test("does not synthesize a missing binding when another account binding uses the device MAC", async () => {
  await withMockRouterApi(command => {
    if (command[0] === "/ip/hotspot/ip-binding/print") {
      return [{
        ".id": "*1",
        "mac-address": "AA:BB:CC:DD:EE:FF",
        address: "192.168.10.25",
        comment: "other-user",
        type: "regular",
      }];
    }
    if (command[0] === "/system/scheduler/print") {
      return [{
        name: "ochola-paid-user-123",
        comment: "OcholaSupernet paid access expiry",
        "on-event": ':foreach id in=[/ip hotspot ip-binding find where comment="user-123"] do={/ip hotspot ip-binding remove $id}; /ip hotspot active find where user="user-123"',
      }];
    }
    return [];
  }, async port => {
    const snapshot = await getPaidHotspotBindingSnapshot(credentials(port), {
      name: "user-123",
      macAddress: "AA:BB:CC:DD:EE:FF",
    });
    assert.equal(snapshot, null);
  });
});
