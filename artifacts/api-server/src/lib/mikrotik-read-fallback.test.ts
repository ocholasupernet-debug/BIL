import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { RouterOSAPI } from "node-routeros";
import {
  buildManagedResetPlan,
  ensureHotspotServerAddressPool,
  ensureRouterFileDirectory,
  fetchBridgePortLayout,
  pingRouter,
  testConnection,
} from "./mikrotik.js";

type MockRows = Record<string, string>[];
type MockContext = {
  port: number;
  connectedUsers: string[];
  commands: Array<{ username: string; command: string[] }>;
};

async function withMockRouterApi<T>(
  respond: (username: string, command: string[]) => Promise<MockRows> | MockRows,
  run: (context: MockContext) => Promise<T>,
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

  const connectedUsers: string[] = [];
  const commands: MockContext["commands"] = [];
  const originalConnect = RouterOSAPI.prototype.connect;
  const originalWrite = RouterOSAPI.prototype.write;
  const originalClose = RouterOSAPI.prototype.close;

  RouterOSAPI.prototype.connect = async function () {
    connectedUsers.push(this.user);
    this.connected = true;
    return this;
  };
  RouterOSAPI.prototype.write = async function (params, ...moreParams) {
    const command = Array.isArray(params)
      ? params
      : [params, ...moreParams.flatMap(value => Array.isArray(value) ? value : [value])];
    commands.push({ username: this.user, command });
    return await respond(this.user, command) as never;
  };
  RouterOSAPI.prototype.close = async function () {
    this.connected = false;
    return this;
  };

  try {
    return await run({ port: address.port, connectedUsers, commands });
  } finally {
    RouterOSAPI.prototype.connect = originalConnect;
    RouterOSAPI.prototype.write = originalWrite;
    RouterOSAPI.prototype.close = originalClose;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

const savedAccount = "legacy-router-account";
const managementAccount = "ocholasupernet";

function routerCredentials(port: number, alternateUsernames?: string[]) {
  return {
    host: "127.0.0.1",
    port,
    username: savedAccount,
    password: "test-password",
    alternateUsernames,
    connectTimeoutMs: 1_000,
    requestTimeoutMs: 1_000,
  };
}

test("RouterOS read-only checks fall back after a permission-denied probe", async (t) => {
  await t.test("ping returns identity and version from the management account", async () => {
    await withMockRouterApi((username, command) => {
      if (username === savedAccount) {
        throw new Error("not enough permissions (RouterOS 7 policy)");
      }
      if (command[0] === "/system/identity/print") return [{ name: "edge-router-7" }];
      if (command[0] === "/system/resource/print") {
        return [{ version: "7.16.2", uptime: "1d2h" }];
      }
      return [];
    }, async ({ port, connectedUsers, commands }) => {
      const result = await pingRouter(routerCredentials(port, [managementAccount]));

      assert.equal(result.online, true);
      assert.equal(result.identity, "edge-router-7");
      assert.equal(result.version, "7.16.2");
      assert.deepEqual(connectedUsers, [savedAccount, managementAccount]);
      assert.ok(commands.every(({ command }) =>
        command[0] === "/system/identity/print" || command[0] === "/system/resource/print",
      ));
    });
  });

  await t.test("ping retries when the saved account returns empty identity/version rows", async () => {
    await withMockRouterApi((username, command) => {
      if (username === savedAccount) return [];
      if (command[0] === "/system/identity/print") return [{ name: "edge-router-7" }];
      if (command[0] === "/system/resource/print") {
        return [{ version: "7.16.2", uptime: "1d2h" }];
      }
      return [];
    }, async ({ port, connectedUsers }) => {
      const result = await pingRouter(routerCredentials(port, [managementAccount]));

      assert.equal(result.online, true);
      assert.equal(result.identity, "edge-router-7");
      assert.equal(result.version, "7.16.2");
      assert.deepEqual(connectedUsers, [savedAccount, managementAccount]);
    });
  });

  await t.test("connection check falls back for identity and RouterOS version", async () => {
    await withMockRouterApi((username, command) => {
      if (username === savedAccount) {
        throw new Error("not enough permissions (RouterOS 7 policy)");
      }
      if (command[0] === "/system/identity/print") return [{ name: "edge-router-7" }];
      if (command[0] === "/system/resource/print") return [{ version: "7.16.2" }];
      return [];
    }, async ({ port, connectedUsers }) => {
      const result = await testConnection(routerCredentials(port, [managementAccount]));

      assert.equal(result.ok, true);
      assert.equal(result.routerIdentity, "edge-router-7");
      assert.equal(result.rosVersion, "7.16.2");
      assert.deepEqual(connectedUsers, [savedAccount, managementAccount]);
    });
  });

  await t.test("read-only bridge verification falls back to the management account", async () => {
    await withMockRouterApi((username, command) => {
      if (username === savedAccount) {
        throw new Error("not enough permissions (RouterOS 7 policy)");
      }
      if (command[0] === "/interface/print") {
        return [{ ".id": "*1", name: "wlan2", type: "wlan", running: "true" }];
      }
      if (command[0] === "/interface/bridge/print") {
        return [{ name: "hotspot-bridge", running: "true" }];
      }
      if (command[0] === "/interface/bridge/port/print") {
        return [{ ".id": "*2", bridge: "hotspot-bridge", interface: "wlan2" }];
      }
      return [];
    }, async ({ port, connectedUsers, commands }) => {
      const result = await fetchBridgePortLayout(routerCredentials(port, [managementAccount]));

      assert.deepEqual(connectedUsers, [savedAccount, managementAccount]);
      assert.deepEqual(result.interfaces.map(item => item.name), ["wlan2"]);
      assert.deepEqual(result.bridges.map(item => item.name), ["hotspot-bridge"]);
      assert.deepEqual(
        result.bridgePorts.map(item => [item.bridge, item.interface]),
        [["hotspot-bridge", "wlan2"]],
      );
      assert.ok(commands.some(({ username }) => username === managementAccount));
    });
  });

  await t.test("does not try another account when none is configured", async () => {
    await withMockRouterApi(() => {
      throw new Error("not enough permissions (RouterOS 7 policy)");
    }, async ({ port, connectedUsers }) => {
      const result = await testConnection(routerCredentials(port));

      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /not enough permissions/);
      assert.deepEqual(connectedUsers, [savedAccount]);
    });
  });
});

test("managed reset planning retries empty access inventory with the management account and stays read-only", async () => {
  await withMockRouterApi((username, command) => {
    if (username === savedAccount) return [];
    if (command[0] === "/system/identity/print") return [{ name: "edge-router-7" }];
    if (command[0] === "/system/resource/print") return [{ version: "7.16.2" }];
    if (command[0] === "/ip/service/print") return [{ name: "api", disabled: "false" }];
    if (command[0] === "/interface/ovpn-client/print") {
      return [{
        name: "ocholasupernet",
        comment: "DO NOT DELETE - OcholaSupernet management VPN",
        disabled: "false",
      }];
    }
    if (command[0] === "/ip/pool/print") {
      return [{ ".id": "*1", name: "managed-pool", comment: "ochola-services-7 owned pool" }];
    }
    return [];
  }, async ({ port, connectedUsers, commands }) => {
    const plan = await buildManagedResetPlan(
      routerCredentials(port, [managementAccount]),
      7,
      "edge-router-7",
    );

    assert.equal(plan.identity, "edge-router-7");
    assert.equal(plan.version, "7.16.2");
    assert.equal(plan.apiServiceAvailable, true);
    assert.equal(plan.protectedVpnClients.length, 1);
    assert.equal(plan.items.length, 1);
    assert.equal(plan.items[0]?.name, "managed-pool");
    assert.equal(plan.eligible, false, "a non-management-VPN connection must not be eligible");
    assert.deepEqual(connectedUsers, [savedAccount, managementAccount]);
    assert.ok(commands.every(({ command }) => command[0].endsWith("/print")));
  });
});

test("a failed RouterOS mutation is not replayed with the alternate account", async () => {
  await withMockRouterApi((username, command) => {
    if (command[0] === "/ip/pool/print") {
      return [{ ".id": "*1", name: "customer-pool", ranges: "" }];
    }
    if (command[0] === "/ip/pool/set") {
      throw new Error("connection lost after the router applied the update");
    }
    return [];
  }, async ({ port, connectedUsers, commands }) => {
    await assert.rejects(
      ensureHotspotServerAddressPool(routerCredentials(port, [managementAccount]), {
        serverName: "customer-hotspot",
        poolName: "customer-pool",
        poolRanges: "192.168.50.10-192.168.50.250",
      }),
      /connection lost after the router applied the update/,
    );

    assert.deepEqual(connectedUsers, [savedAccount, savedAccount]);
    assert.equal(
      commands.filter(({ command }) => command[0] === "/ip/pool/set").length,
      1,
    );
  });
});

test("RouterOS hotspot directories use the supported file/add API command", async (t) => {
  await t.test("creates and verifies a missing directory", async () => {
    let created = false;
    await withMockRouterApi((_username, command) => {
      if (command[0] === "/file/print") {
        return created
          ? [{ ".id": "*1", name: "flash/hotspot/css", type: "directory" }]
          : [];
      }
      if (command[0] === "/file/add") {
        created = true;
        return [];
      }
      return [];
    }, async ({ port, commands }) => {
      await ensureRouterFileDirectory(routerCredentials(port), "flash/hotspot/css");

      assert.deepEqual(commands.map(item => item.command), [
        ["/file/print", "=.proplist=.id,name,type", "?name=flash/hotspot/css"],
        ["/file/add", "=name=flash/hotspot/css", "=type=directory"],
        ["/file/print", "=.proplist=.id,name,type", "?name=flash/hotspot/css"],
      ]);
    });
  });

  await t.test("leaves an existing file at the directory path unchanged", async () => {
    await withMockRouterApi(() => [
      { ".id": "*1", name: "flash/hotspot/css", type: "file" },
    ], async ({ port, commands }) => {
      await assert.rejects(
        ensureRouterFileDirectory(routerCredentials(port), "flash/hotspot/css"),
        /already exists as a file/,
      );
      assert.deepEqual(commands.map(item => item.command[0]), ["/file/print"]);
    });
  });

  await t.test("rejects path traversal before sending a RouterOS command", async () => {
    await withMockRouterApi(() => [], async ({ port, connectedUsers, commands }) => {
      await assert.rejects(
        ensureRouterFileDirectory(routerCredentials(port), "flash/hotspot/../system"),
        /valid RouterOS directory path/,
      );
      assert.deepEqual(connectedUsers, []);
      assert.deepEqual(commands, []);
    });
  });
});