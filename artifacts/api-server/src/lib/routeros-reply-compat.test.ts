import assert from "node:assert/strict";
import { test } from "node:test";
import { Channel } from "node-routeros";
import "./routeros-reply-compat";

test("RouterOS !empty replies resolve as an empty result instead of crashing", async () => {
  let receivePacket: ((packet: string[]) => void) | undefined;
  let stopped = false;
  const connector = {
    read(_tag: string, callback: (packet: string[]) => void) {
      receivePacket = callback;
    },
    write() {
      queueMicrotask(() => receivePacket?.(["!empty"]));
    },
    stopRead() {
      stopped = true;
    },
  };

  const channel = new Channel(connector as never);
  const result = await channel.write(["/ip/hotspot/user/profile/print"]);

  assert.deepEqual(result, []);
  assert.equal(stopped, true);
});