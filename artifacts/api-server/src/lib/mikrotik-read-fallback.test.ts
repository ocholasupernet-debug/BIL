import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { RouterOSAPI } from "node-routeros";
import {
  buildManagedResetPlan,
  connectHotspotUser,
  ensureHotspotServerAddressPool,
  ensureRouterFileDirectory,
  upsertHotspotUser,
  resolveHotspotClientIpByMac,
  fetchBridgePortLayout,
  pingRouter,
  testConnection,
  fetchWireless,
  createWirelessVirtualAp,
  patchWirelessInterface,
  deleteWirelessVirtualAp,
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

test("a matching paid hotspot session is reused without disconnecting it", async () => {
  await withMockRouterApi((_username, command) => {
    if (command[0] === "/ip/hotspot/active/print") {
      return [{ user: "tv-package", address: "10.0.0.88", "mac-address": "AA:BB:CC:DD:EE:FF" }];
    }
    return [];
  }, async ({ port, commands }) => {
    const connected = await connectHotspotUser(routerCredentials(port), {
      user: "tv-package",
      password: "test-password",
      ip: "10.0.0.88",
      macAddress: "AA:BB:CC:DD:EE:FF",
    });

    assert.equal(connected, true);
    assert.deepEqual(commands.map(({ command }) => command[0]), ["/ip/hotspot/active/print"]);
  });
});

test("hotspot login uses the selected device IP and confirms its MAC session", async () => {
  let loginSeen = false;
  const targetMac = "AA:BB:CC:DD:EE:FF";
  await withMockRouterApi((_username, command) => {
    if (command[0] === "/ip/hotspot/active/login") {
      loginSeen = true;
      return [];
    }
    if (command[0] === "/ip/hotspot/active/print" && loginSeen) {
      return [{ user: "tv-package", address: "10.0.0.88", "mac-address": targetMac }];
    }
    return [];
  }, async ({ port, commands }) => {
    const connected = await connectHotspotUser(routerCredentials(port), {
      user: "tv-package",
      password: "test-password",
      ip: "10.0.0.88",
      macAddress: targetMac,
    });

    assert.equal(connected, true);
    const loginCommand = commands.find(({ command }) => command[0] === "/ip/hotspot/active/login")?.command;
    assert.ok(loginCommand?.includes("=ip=10.0.0.88"));
    assert.ok(loginCommand?.includes(`=mac-address=${targetMac}`));
    assert.equal(commands.some(({ command }) => command[0] === "/ip/hotspot/active/remove"), false);
  });
});

test("target hotspot IP lookup stops once the matching MAC is found", async () => {
  await withMockRouterApi((_username, command) => {
    if (command[0] === "/ip/hotspot/active/print") {
      return [{ user: "tv-package", address: "10.0.0.88", "mac-address": "AA:BB:CC:DD:EE:FF" }];
    }
    return [];
  }, async ({ port, commands }) => {
    const address = await resolveHotspotClientIpByMac(
      routerCredentials(port),
      "AA:BB:CC:DD:EE:FF",
    );

    assert.equal(address, "10.0.0.88");
    assert.deepEqual(commands.map(({ command }) => command[0]), ["/ip/hotspot/active/print"]);
  });
});

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

test("wireless inventory maps RouterOS master IDs to names and scopes ownership", async () => {
  await withMockRouterApi((_username, command) => {
    if (command[0] === "/interface/wireless/print") return [
      { ".id": "*1", name: "wlan1", type: "qca", "master-interface": "", comment: "" },
      { ".id": "*2", name: "wlan1-vap", type: "qca", "master-interface": "*1", comment: "ochola-wireless-app:7:abc123" },
    ];
    if (command[0] === "/interface/wireless/security-profiles/print") return [];
    return [];
  }, async ({ port }) => {
    const result = await fetchWireless(routerCredentials(port), 7);
    assert.equal(result.interfaces[0]?.masterInterface, "");
    assert.equal(result.interfaces[1]?.masterInterface, "wlan1");
    assert.equal(result.interfaces[1]?.managedByApp, true);
  });
});

test("wireless virtual AP creation uses the selected master name, not its RouterOS id", async () => {
  let added: string[] = [];
  let profileName = "";
  await withMockRouterApi((_username, command) => {
    if (command[0] === "/interface/wireless/print") {
      if (command.some(item => item === "?name=vap-test")) {
        return [{ ".id": "*9", name: "vap-test", ssid: "Guest", "master-interface": "wlan1",
          "security-profile": profileName, disabled: "false", comment: "ochola-wireless-app:7:nonce" }];
      }
      return [{ ".id": "*1", name: "wlan1", type: "chipset", "master-interface": "" }];
    }
    if (command[0] === "/interface/wireless/security-profiles/print") return [];
    if (command[0] === "/interface/wireless/security-profiles/add") {
      profileName = command.find(item => item.startsWith("=name="))?.slice("=name=".length) ?? "";
      return [];
    }
    if (command[0] === "/interface/wireless/add") { added = command; return []; }
    return [];
  }, async ({ port }) => {
    await createWirelessVirtualAp(routerCredentials(port), {
      routerId: 7, name: "vap-test", ssid: "Guest", masterInterfaceId: "*1", password: "password1",
    });
    assert.ok(added.includes("=master-interface=wlan1"));
    assert.ok(!added.includes("=master-interface=*1"));
  });
});

test("wireless patch isolates password, sets disabled, and never edits default profile", async () => {
  const commands: string[][] = [];
  const current: Record<string, string> = {
    ".id": "*2", name: "wlan-vap", ssid: "Guest", "master-interface": "wlan1",
    "security-profile": "default", disabled: "false",
  };
  const profiles: Record<string, string>[] = [{
    ".id": "*3", name: "default", "wpa2-pre-shared-key": "unchanged",
    comment: "RouterOS default profile",
  }];
  await withMockRouterApi((_username, command) => {
    commands.push(command);
    if (command[0] === "/interface/wireless/print") return [current];
    if (command[0] === "/interface/wireless/set") {
      for (const item of command.slice(2)) {
        const separator = item.indexOf("=", 1);
        const key = item.slice(1, separator);
        const value = item.slice(separator + 1);
        if (key === "ssid") current.ssid = value;
        if (key === "disabled") current.disabled = value;
        if (key === "security-profile") current["security-profile"] = value;
      }
      return [];
    }
    if (command[0] === "/interface/wireless/security-profiles/add") {
      const profile: Record<string, string> = { ".id": "*4" };
      for (const item of command.slice(1)) {
        const separator = item.indexOf("=", 1);
        profile[item.slice(1, separator)] = item.slice(separator + 1);
      }
      profiles.push(profile);
      return [];
    }
    if (command[0] === "/interface/wireless/security-profiles/print") {
      const nameFilter = command.find(item => item.startsWith("?name="))?.slice("?name=".length);
      return nameFilter ? profiles.filter(profile => profile.name === nameFilter) : profiles;
    }
    return [];
  }, async ({ port }) => {
    await patchWirelessInterface(routerCredentials(port), 7, {
      interfaceId: "*2", ssid: "Guest Wi-Fi", password: "newpass123", disabled: true,
    });
    assert.ok(commands.some(command => command[0] === "/interface/wireless/set" && command.includes("=disabled=yes")));
    assert.ok(commands.some(command => command[0] === "/interface/wireless/security-profiles/add" && command.some(item => item.startsWith("=name=ochola-wlan-7-"))));
    assert.ok(!commands.some(command => command[0] === "/interface/wireless/security-profiles/set"));
    assert.equal(current.ssid, "Guest Wi-Fi");
    assert.equal(current.disabled, "yes");
    assert.notEqual(current["security-profile"], "default");
    assert.equal(profiles.find(profile => profile.name === "default")?.["wpa2-pre-shared-key"], "unchanged");
    assert.equal(profiles.find(profile => profile.name === current["security-profile"])?.["wpa2-pre-shared-key"], "newpass123");
  });
});

test("wireless deletion refuses physical and unowned interfaces", async (t) => {
  for (const row of [
    { ".id": "*1", name: "wlan1", "master-interface": "", comment: "ochola-wireless-app:7:abc" },
    { ".id": "*2", name: "vap", "master-interface": "wlan1", comment: "customer-managed" },
  ]) {
    await t.test(row.name, async ({}) => {
      await withMockRouterApi(() => [row], async ({ port }) => {
        await assert.rejects(
          deleteWirelessVirtualAp(routerCredentials(port), 7, row[".id"]),
          /Only app-owned virtual wireless/,
        );
      });
    });
  }
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

test("a failed pool mutation is not replayed and keeps the RouterOS connection", async () => {
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

    assert.deepEqual(connectedUsers, [savedAccount]);
    assert.equal(
      commands.filter(({ command }) => command[0] === "/ip/pool/set").length,
      1,
    );
  });
});

test("paid hotspot user upsert creates or updates through one RouterOS connection", async () => {
  await withMockRouterApi((_username, command) => {
    if (command[0] === "/ip/hotspot/user/print") return [];
    return [];
  }, async ({ port, connectedUsers, commands }) => {
    await upsertHotspotUser(routerCredentials(port), {
      name: "paid-tv-account",
      password: "12345",
      profile: "tv-package",
      disabled: false,
      comment: "paid-tv-account",
      limitBytesTotal: "0",
    });
    assert.deepEqual(connectedUsers, [savedAccount]);
    assert.deepEqual(commands.map(({ command }) => command[0]), [
      "/ip/hotspot/user/print",
      "/ip/hotspot/user/add",
    ]);
    assert.ok(commands[1]?.command.includes("=disabled=no"));
    assert.ok(commands[1]?.command.includes("=limit-bytes-total=0"));
  });

  await withMockRouterApi((_username, command) => {
    if (command[0] === "/ip/hotspot/user/print") {
      return [{ ".id": "*7", name: "paid-tv-account" }];
    }
    return [];
  }, async ({ port, connectedUsers, commands }) => {
    await upsertHotspotUser(routerCredentials(port), {
      name: "paid-tv-account",
      password: "12345",
      profile: "tv-package",
      disabled: false,
    });
    assert.deepEqual(connectedUsers, [savedAccount]);
    assert.deepEqual(commands.map(({ command }) => command[0]), [
      "/ip/hotspot/user/print",
      "/ip/hotspot/user/set",
    ]);
    assert.ok(commands[1]?.command.includes("=.id=*7"));
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