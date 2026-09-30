import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { RouterOSAPI } from "node-routeros";
import { guardRouterOSConnection, RouterOSConnectionLostError } from "./routeros-connection";

function fakeRouterOSConnection(): RouterOSAPI {
  const connection = new EventEmitter() as EventEmitter & {
    write: RouterOSAPI["write"];
  };
  connection.write = () => new Promise<never>(() => undefined);
  return connection as unknown as RouterOSAPI;
}

test("post-connect RouterOS errors reject in-flight and subsequent writes", async () => {
  const connection = guardRouterOSConnection(fakeRouterOSConnection());
  const inFlight = connection.write(["/system/resource/print"]);

  connection.emit("error", new Error("Timed out after 6 seconds"));

  await assert.rejects(inFlight, (error: unknown) =>
    error instanceof RouterOSConnectionLostError
    && error.message === "Timed out after 6 seconds",
  );
  await assert.rejects(
    connection.write(["/ip/hotspot/user/print"]),
    RouterOSConnectionLostError,
  );
});

test("a closed RouterOS connection rejects pending writes", async () => {
  const connection = guardRouterOSConnection(fakeRouterOSConnection());
  const inFlight = connection.write(["/system/resource/print"]);

  connection.emit("close");

  await assert.rejects(inFlight, RouterOSConnectionLostError);
});