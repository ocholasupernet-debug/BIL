import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { RouterOSAPI } from "node-routeros";
import {
  getPaidHotspotBindingSnapshot,
  hasPaidHotspotAccess,
  reconcilePaidHotspotBinding,
} from "./mikrotik.js";

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

test("recovers a unique paid binding when the customer's saved MAC is stale", async () => {
  await withMockRouterApi(command => {
    if (command[0] === "/ip/hotspot/ip-binding/print") {
      return [{
        ".id": "*1",
        "mac-address": "11:22:33:44:55:66",
        address: "192.168.10.26",
        comment: "user-123",
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
    const router = credentials(port);
    const snapshot = await getPaidHotspotBindingSnapshot(router, {
      name: "user-123",
      macAddress: "AA:BB:CC:DD:EE:FF",
    });
    assert.deepEqual(snapshot, {
      macAddress: "11:22:33:44:55:66",
      ipAddress: "192.168.10.26",
      comment: "user-123",
      bindingType: "regular",
    });
    assert.equal(await hasPaidHotspotAccess(router, {
      name: "user-123",
      macAddress: "AA:BB:CC:DD:EE:FF",
    }), true);
  });
});

test("extends the verified router MAC binding and reenables its paid expiry scheduler", async () => {
  const commands: string[][] = [];
  await withMockRouterApi(command => {
    commands.push([...command]);
    if (command[0] === "/ip/hotspot/ip-binding/print") {
      return [{
        ".id": "*1",
        "mac-address": "11:22:33:44:55:66",
        address: "192.168.10.26",
        comment: "user-123",
        type: "regular",
      }];
    }
    if (command[0] === "/system/scheduler/print") {
      return [{
        ".id": "*2",
        name: "ochola-paid-user-123",
        comment: "OcholaSupernet paid access expiry",
        "on-event": ':foreach id in=[/ip hotspot ip-binding find where comment="user-123"] do={/ip hotspot ip-binding remove $id}; /ip hotspot active find where user="user-123"',
        disabled: "yes",
      }];
    }
    if (command[0] === "/system/clock/print") {
      return [{ date: "oct/07/2026", time: "12:00:00" }];
    }
    return [];
  }, async port => {
    const router = credentials(port);
    const snapshot = await getPaidHotspotBindingSnapshot(router, {
      name: "user-123",
      macAddress: "AA:BB:CC:DD:EE:FF",
    });
    assert.ok(snapshot);
    assert.equal(snapshot.macAddress, "11:22:33:44:55:66");
    await reconcilePaidHotspotBinding(router, {
      snapshot,
      currentName: "user-123",
      currentMacAddress: snapshot.macAddress,
      nextName: "user-123",
      nextMacAddress: snapshot.macAddress,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      enabled: true,
    });
  });
  const schedulerUpdate = commands.find(command => command[0] === "/system/scheduler/set");
  assert.ok(schedulerUpdate);
  assert.ok(schedulerUpdate.includes("=disabled=no"));
  const bindingUpdate = commands.find(command => command[0] === "/ip/hotspot/ip-binding/set");
  assert.ok(bindingUpdate);
  assert.ok(bindingUpdate.includes("=type=regular"));
  assert.ok(bindingUpdate.includes("=comment=user-123"));
  assert.ok(commands.some(command =>
    command[0] === "/ip/hotspot/ip-binding/print"
    && command.includes("?mac-address=11:22:33:44:55:66"),
  ));
});

test("fails closed when a stale-MAC username binding lacks its managed expiry scheduler", async () => {
  await withMockRouterApi(command => {
    if (command[0] === "/ip/hotspot/ip-binding/print") {
      return [{
        ".id": "*1",
        "mac-address": "11:22:33:44:55:66",
        address: "192.168.10.26",
        comment: "user-123",
        type: "regular",
      }];
    }
    if (command[0] === "/system/scheduler/print") return [];
    return [];
  }, async port => {
    const router = credentials(port);
    await assert.rejects(
      getPaidHotspotBindingSnapshot(router, {
        name: "user-123",
        macAddress: "AA:BB:CC:DD:EE:FF",
      }),
      /saved device identity is stale/,
    );
    await assert.rejects(
      hasPaidHotspotAccess(router, {
        name: "user-123",
        macAddress: "AA:BB:CC:DD:EE:FF",
      }),
      /saved device identity is stale/,
    );
  });
});

test("accepts every device binding for a username only with its managed expiry scheduler", async () => {
  await withMockRouterApi(command => {
    if (command[0] === "/ip/hotspot/ip-binding/print") {
      return [
        {
          ".id": "*1",
          "mac-address": "11:22:33:44:55:66",
          address: "192.168.10.26",
          comment: "user-123",
          type: "regular",
        },
        {
          ".id": "*2",
          "mac-address": "22:33:44:55:66:77",
          address: "192.168.10.27",
          comment: "user-123",
          type: "regular",
        },
      ];
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
      macAddress: "11:22:33:44:55:66",
      ipAddress: "192.168.10.26",
      comment: "user-123",
      bindingType: "regular",
      bindings: [
        {
          macAddress: "11:22:33:44:55:66",
          ipAddress: "192.168.10.26",
          comment: "user-123",
          bindingType: "regular",
        },
        {
          macAddress: "22:33:44:55:66:77",
          ipAddress: "192.168.10.27",
          comment: "user-123",
          bindingType: "regular",
        },
      ],
    });
  });
});

test("repairs a blocked binding only after verifying its paid expiry scheduler", async () => {
  const commands: string[][] = [];
  await withMockRouterApi(command => {
    commands.push([...command]);
    if (command[0] === "/ip/hotspot/ip-binding/print") {
      return [{
        ".id": "*1",
        "mac-address": "AA:BB:CC:DD:EE:FF",
        address: "192.168.10.25",
        comment: "user-123",
        type: "blocked",
      }];
    }
    if (command[0] === "/system/scheduler/print") {
      return [{
        ".id": "*2",
        name: "ochola-paid-user-123",
        comment: "OcholaSupernet paid access expiry",
        "on-event": ':foreach id in=[/ip hotspot ip-binding find where comment="user-123"] do={/ip hotspot ip-binding remove $id}; /ip hotspot active find where user="user-123"',
      }];
    }
    if (command[0] === "/system/clock/print") {
      return [{ date: "oct/07/2026", time: "12:00:00" }];
    }
    return [];
  }, async port => {
    const router = credentials(port);
    const snapshot = await getPaidHotspotBindingSnapshot(router, {
      name: "user-123",
      macAddress: "AA:BB:CC:DD:EE:FF",
    });
    assert.equal(snapshot?.bindingType, "regular");
    assert.equal(snapshot?.macAddress, "AA:BB:CC:DD:EE:FF");

    await reconcilePaidHotspotBinding(router, {
      snapshot: snapshot!,
      currentName: "user-123",
      currentMacAddress: snapshot!.macAddress,
      nextName: "user-123",
      nextMacAddress: snapshot!.macAddress,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      enabled: true,
    });
  });
  assert.ok(commands.some(command =>
    command[0] === "/ip/hotspot/ip-binding/set"
    && command.includes("=.id=*1")
    && command.includes("=type=regular"),
  ));
});

test("keeps multiple username bindings ambiguous when no managed expiry scheduler exists", async () => {
  await withMockRouterApi(command => {
    if (command[0] === "/ip/hotspot/ip-binding/print") {
      return [
        {
          ".id": "*1",
          "mac-address": "11:22:33:44:55:66",
          address: "192.168.10.26",
          comment: "user-123",
          type: "regular",
        },
        {
          ".id": "*2",
          "mac-address": "22:33:44:55:66:77",
          address: "192.168.10.27",
          comment: "user-123",
          type: "regular",
        },
      ];
    }
    if (command[0] === "/system/scheduler/print") return [];
    return [];
  }, async port => {
    await assert.rejects(
      getPaidHotspotBindingSnapshot(credentials(port), {
        name: "user-123",
        macAddress: "AA:BB:CC:DD:EE:FF",
      }),
      /multiple or incomplete/,
    );
  });
});

test("extends every device binding in a verified managed account", async () => {
  const commands: string[][] = [];
  const bindings = [
    {
      ".id": "*1",
      "mac-address": "11:22:33:44:55:66",
      address: "192.168.10.26",
      comment: "user-123",
      type: "regular",
    },
    {
      ".id": "*2",
      "mac-address": "22:33:44:55:66:77",
      address: "192.168.10.27",
      comment: "user-123",
      type: "regular",
    },
  ];
  await withMockRouterApi(command => {
    commands.push([...command]);
    if (command[0] === "/ip/hotspot/ip-binding/print") {
      const macFilter = command.find(value => value.startsWith("?mac-address="))?.slice(13);
      return macFilter
        ? bindings.filter(row => row["mac-address"] === macFilter)
        : bindings;
    }
    if (command[0] === "/system/scheduler/print") {
      return [{
        ".id": "*3",
        name: "ochola-paid-user-123",
        comment: "OcholaSupernet paid access expiry",
        "on-event": ':foreach id in=[/ip hotspot ip-binding find where comment="user-123"] do={/ip hotspot ip-binding remove $id}; /ip hotspot active find where user="user-123"',
      }];
    }
    if (command[0] === "/system/clock/print") {
      return [{ date: "oct/07/2026", time: "12:00:00" }];
    }
    return [];
  }, async port => {
    const router = credentials(port);
    const snapshot = await getPaidHotspotBindingSnapshot(router, {
      name: "user-123",
      macAddress: "AA:BB:CC:DD:EE:FF",
    });
    assert.ok(snapshot?.bindings);
    await reconcilePaidHotspotBinding(router, {
      snapshot,
      currentName: "user-123",
      currentMacAddress: "AA:BB:CC:DD:EE:FF",
      nextName: "user-123",
      nextMacAddress: "AA:BB:CC:DD:EE:FF",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      enabled: true,
    });
  });
  const bindingUpdates = commands.filter(command => command[0] === "/ip/hotspot/ip-binding/set");
  assert.equal(bindingUpdates.length, 2);
  assert.ok(bindingUpdates.some(command => command.includes("=.id=*1")));
  assert.ok(bindingUpdates.some(command => command.includes("=.id=*2")));
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
