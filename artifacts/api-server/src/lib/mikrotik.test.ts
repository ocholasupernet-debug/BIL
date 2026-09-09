import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import { after, before, test } from "node:test";
import { RouterOSAPI } from "node-routeros";
import {
  deployRouterFile,
  type RouterCredentials,
  type RouterFile,
} from "./mikrotik";

interface FakeRouterState {
  files: RouterFile[];
  calls: string[][];
  fetchError?: Error;
}

const routerStates = new Map<number, FakeRouterState>();

const originalConnect = RouterOSAPI.prototype.connect;
const originalWrite = RouterOSAPI.prototype.write;
const originalClose = RouterOSAPI.prototype.close;

const credentials = (port: number): RouterCredentials => ({
  host: "127.0.0.1",
  port,
  username: "test-user",
  password: "test-password",
  connectTimeoutMs: 250,
  requestTimeoutMs: 250,
});

function file(name: string, id: string, size = 42): RouterFile {
  return {
    id,
    name,
    type: "file",
    size,
    creationTime: "2026-08-28 00:00:00",
  };
}

function commandValue(command: string[], key: string): string | undefined {
  return command
    .find((part) => part.startsWith(`=${key}=`))
    ?.slice(key.length + 2);
}

before(async () => {
  RouterOSAPI.prototype.connect = async function () {
    this.connected = true;
    return this;
  };
  RouterOSAPI.prototype.write = async function (
    params: string | string[],
    ...moreParams: Array<string | string[]>
  ) {
    const state = routerStates.get(this.port);
    assert.ok(state, `no fake router registered for port ${this.port}`);
    const command = [
      ...(Array.isArray(params) ? params : [params]),
      ...moreParams.flatMap((part) => (Array.isArray(part) ? part : [part])),
    ];
    state.calls.push(command);

    switch (command[0]) {
      case "/file/print":
        return state.files.map((entry) => ({
          ".id": entry.id,
          name: entry.name,
          type: entry.type,
          size: String(entry.size),
          "creation-time": entry.creationTime,
        }));
      case "/tool/fetch": {
        const destinationPath = commandValue(command, "dst-path");
        assert.ok(
          destinationPath,
          "fetch should include a destination",
        );
        if (state.fetchError) throw state.fetchError;
        const transferred = file(destinationPath, `temporary-${state.files.length}`);
        const existingIndex = state.files.findIndex((entry) => entry.name === destinationPath);
        if (existingIndex >= 0) {
          state.files[existingIndex] = transferred;
        } else {
          state.files.push(transferred);
        }
        return [];
      }
      case "/file/remove": {
        const id = commandValue(command, ".id");
        assert.ok(id, "remove should include a file id");
        state.files = state.files.filter((entry) => entry.id !== id);
        return [];
      }
      default:
        throw new Error(`Unexpected RouterOS command: ${command[0]}`);
    }
  };
  RouterOSAPI.prototype.close = async function () {
    this.connected = false;
    return this;
  };
});

after(async () => {
  RouterOSAPI.prototype.connect = originalConnect;
  RouterOSAPI.prototype.write = originalWrite;
  RouterOSAPI.prototype.close = originalClose;
});

async function withFakeRouter<T>(
  state: FakeRouterState,
  callback: (port: number) => Promise<T>,
): Promise<T> {
  const server = net.createServer((socket) => socket.destroy());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;
  routerStates.set(port, state);

  try {
    return await callback(port);
  } finally {
    routerStates.delete(port);
    server.close();
    await once(server, "close");
  }
}

test("deploys hotspot assets and RouterOS scripts through the RouterOS connection", async () => {
  await withFakeRouter({ files: [], calls: [] }, async (port) => {
    const state = routerStates.get(port);
    assert.ok(state);

    const hotspot = await deployRouterFile(credentials(port), {
      destinationPath: "hotspot/login.html",
      sourceUrl: "http://example.test/login.html",
      overwrite: false,
      uploadId: "hotspot-test",
    });
    const script = await deployRouterFile(credentials(port), {
      destinationPath: "router-setup.rsc",
      sourceUrl: "http://example.test/router-setup.rsc",
      overwrite: false,
      uploadId: "script-test",
    });

    assert.equal(hotspot.destinationPath, "hotspot/login.html");
    assert.equal(hotspot.size, 42);
    assert.equal(hotspot.connectedHost, "127.0.0.1");
    assert.equal(hotspot.replaced, false);
    assert.equal(script.destinationPath, "router-setup.rsc");
    assert.equal(script.connectedHost, "127.0.0.1");
    assert.equal(script.replaced, false);
    assert.deepEqual(
      state.files.map((entry) => entry.name),
      ["hotspot/login.html", "router-setup.rsc"],
    );
    assert.equal(
      state.calls.filter(([command]) => command === "/tool/fetch").length,
      2,
    );
  });
});

test("returns an existing-file conflict without removing the original", async () => {
  await withFakeRouter(
    {
      files: [file("hotspot/login.html", "original-id", 99)],
      calls: [],
    },
    async (port) => {
      const state = routerStates.get(port);
      assert.ok(state);

      await assert.rejects(
        deployRouterFile(credentials(port), {
          destinationPath: "hotspot/login.html",
          sourceUrl: "http://example.test/login.html",
          overwrite: false,
          uploadId: "conflict-test",
        }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "FILE_EXISTS");
          assert.equal(
            (error as { existingFile?: RouterFile }).existingFile?.id,
            "original-id",
          );
          return true;
        },
      );

      assert.deepEqual(
        state.files.map((entry) => entry.name),
        ["hotspot/login.html"],
      );
      assert.equal(
        state.calls.some(([command]) => command === "/tool/fetch"),
        false,
      );
      assert.equal(
        state.calls.some(([command]) => command === "/file/remove"),
        false,
      );
    },
  );
});

test("reports an explicit replacement after a direct destination transfer", async () => {
  await withFakeRouter(
    {
      files: [file("router-setup.rsc", "original-id", 99)],
      calls: [],
    },
    async (port) => {
      const state = routerStates.get(port);
      assert.ok(state);

      const result = await deployRouterFile(credentials(port), {
        destinationPath: "router-setup.rsc",
        sourceUrl: "http://example.test/router-setup.rsc",
        overwrite: true,
        uploadId: "replace-test",
      });

      const fetchIndex = state.calls.findIndex(
        ([command]) => command === "/tool/fetch",
      );
      assert.ok(fetchIndex >= 0);
      assert.equal(
        state.calls.some(([command]) => command === "/file/remove"),
        false,
      );
      assert.equal(
        state.calls.some(([command]) => command === "/file/set"),
        false,
      );
      assert.equal(result.replaced, true);
      assert.deepEqual(
        state.files.map((entry) => entry.name),
        ["router-setup.rsc"],
      );
      assert.equal(state.files[0]?.id, "temporary-1");
    },
  );
});

test("leaves the existing destination when the transfer fails", async () => {
  await withFakeRouter(
    {
      files: [file("router-setup.rsc", "original-id", 99)],
      calls: [],
      fetchError: new Error("simulated fetch failure"),
    },
    async (port) => {
      const state = routerStates.get(port);
      assert.ok(state);

      await assert.rejects(
        deployRouterFile(credentials(port), {
          destinationPath: "router-setup.rsc",
          sourceUrl: "http://example.test/router-setup.rsc",
          overwrite: true,
          uploadId: "failed-transfer-test",
        }),
        /simulated fetch failure/,
      );

      assert.deepEqual(
        state.files.map((entry) => entry.name),
        ["router-setup.rsc"],
      );
      assert.equal(state.files[0]?.id, "original-id");
      assert.equal(
        state.calls.filter(([command]) => command === "/file/remove").length,
        0,
      );
    },
  );
});