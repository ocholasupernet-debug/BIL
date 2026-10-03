import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import test from "node:test";
import "./routeros-reply-compat";
import {
  addHotspotUserProfile,
  disconnectHotspotActiveUser,
  removeHotspotUserFup,
  requireHotspotUserProfile,
  resetHotspotUserCounters,
  scheduleHotspotUserExpiry,
  upsertHotspotUser,
} from "./mikrotik";

type Row = Record<string, string>;

function sentence(words: string[]): Buffer {
  return Buffer.concat([
    ...words.flatMap(word => {
      const bytes = Buffer.from(word);
      assert.ok(bytes.length < 16384);
      const size = bytes.length < 128
        ? Buffer.from([bytes.length])
        : Buffer.from([(bytes.length >> 8) | 0x80, bytes.length & 0xff]);
      return [size, bytes];
    }),
    Buffer.from([0]),
  ]);
}

// A TCP-level fixture: leave RouterOSAPI.connect/write, Channel, Receiver and
// the production provisioning functions intact. No real router or payment.
async function withRouter(run: (port: number, rows: Map<string, Row[]>, commands: string[][]) => Promise<void>) {
  const rows = new Map<string, Row[]>();
  const commands: string[][] = [];
  const sockets = new Set<Socket>();
  let nextId = 1;
  let splitEmptyReply = false;
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    let words: string[] = [];

    const respond = (command: string[]) => {
      const tag = command.find(word => word.startsWith(".tag="));
      assert.ok(tag);
      const path = command[0];
      commands.push(command.filter(word => !word.startsWith(".tag=")));
      const send = (reply: string, values: Row = {}) =>
        socket.write(sentence([reply, ...Object.entries(values).map(([key, value]) => `=${key}=${value}`), tag]));
      if (path === "/login") {
        send("!done");
        return;
      }
      const resource = path.slice(0, path.lastIndexOf("/"));
      const action = path.slice(path.lastIndexOf("/") + 1);
      const props = Object.fromEntries(command.filter(word => word.startsWith("=")).map(word => {
        const equals = word.indexOf("=", 1);
        return [word.slice(1, equals), word.slice(equals + 1)];
      }));
      let result: Row[] = [];
      if (action === "print") {
        result = resource === "/system/clock"
          ? [{ date: "2026-10-03", time: "08:00:00" }]
          : (rows.get(resource) ?? []).filter(row => command.filter(word => word.startsWith("?")).every(word => {
              const equals = word.indexOf("=");
              return row[word.slice(1, equals)] === word.slice(equals + 1);
            }));
      } else if (action === "add") {
        const row = { ...props, ".id": `*${nextId++}` };
        rows.set(resource, [...(rows.get(resource) ?? []), row]);
        send("!done", { ret: row[".id"] });
        return;
      } else if (action === "set") {
        const row = (rows.get(resource) ?? []).find(candidate => candidate[".id"] === props[".id"]);
        assert.ok(row, `set target must exist: ${resource}`);
        Object.assign(row, props);
      } else if (action === "reset-counters") {
        // No-data commands use the new marker too.
      } else {
        send("!trap", { message: `unsupported fixture command: ${path}` });
        send("!done");
        return;
      }
      if (result.length) {
        for (const row of result) send("!re", row);
        send("!done");
      } else {
        // Test both coalesced and separately delivered empty/final replies.
        splitEmptyReply = !splitEmptyReply;
        if (splitEmptyReply) {
          send("!empty");
          setTimeout(() => { if (!socket.destroyed) send("!done"); }, 3);
        } else {
          socket.write(Buffer.concat([sentence(["!empty", tag]), sentence(["!done", tag])]));
        }
      }
    };
    socket.on("data", data => {
      pending = Buffer.concat([pending, typeof data === "string" ? Buffer.from(data) : data]);
      while (pending.length) {
        const sizeBytes = pending[0] < 128 ? 1 : 2;
        if (pending.length < sizeBytes) return;
        const size = sizeBytes === 1 ? pending[0] : ((pending[0] & 0x7f) << 8) | pending[1];
        if (pending.length < sizeBytes + size) return;
        const word = pending.subarray(sizeBytes, sizeBytes + size).toString();
        pending = pending.subarray(sizeBytes + size);
        if (size) words.push(word);
        else if (words.length) {
          const command = words;
          words = [];
          respond(command);
        }
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(address.port, rows, commands);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test("plan creation and paid package activation/renewal survive real !empty/!done wire replies", { timeout: 20000 }, async () => {
  await withRouter(async (port, rows, commands) => {
    const credentials = {
      host: "127.0.0.1", port, username: "test-api", password: "test-only",
      connectTimeoutMs: 1000, requestTimeoutMs: 1000,
    };
    await addHotspotUserProfile(credentials, { name: "paid-plan", rateLimit: "5M/10M" });
    await requireHotspotUserProfile(credentials, "paid-plan");
    const purchase = { name: "paid-device", password: "test-only", profile: "paid-plan", disabled: false };
    await upsertHotspotUser(credentials, purchase);
    await disconnectHotspotActiveUser(credentials, purchase.name);
    await resetHotspotUserCounters(credentials, purchase.name);
    await removeHotspotUserFup(credentials, purchase.name);
    await scheduleHotspotUserExpiry(credentials, { name: purchase.name, expiresInSeconds: 3600 });
    // Renew the same account and update its existing expiry scheduler.
    await upsertHotspotUser(credentials, { ...purchase, limitBytesTotal: "104857600" });
    await scheduleHotspotUserExpiry(credentials, { name: purchase.name, expiresInSeconds: 7200 });
    const users = rows.get("/ip/hotspot/user") ?? [];
    assert.equal(users.length, 1);
    assert.equal(users[0].profile, "paid-plan");
    assert.equal(users[0]["limit-bytes-total"], "104857600");
    assert.equal((rows.get("/system/scheduler") ?? []).length, 1);
    for (const path of [
      "/ip/hotspot/user/profile/add", "/ip/hotspot/user/add", "/ip/hotspot/user/set",
      "/ip/hotspot/user/reset-counters", "/system/scheduler/add", "/system/scheduler/set",
    ]) assert.ok(commands.some(command => command[0] === path), `${path} must complete`);
    await assert.rejects(requireHotspotUserProfile(credentials, "missing-plan"), /does not exist/);
  });
});