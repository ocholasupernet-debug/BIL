import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { Channel } from "node-routeros";
import { Receiver } from "node-routeros/dist/connector/Receiver";
import "./routeros-reply-compat";

// Exercise the actual receiver and channel, not just a single fake callback.
// RouterOS wire sentences end with a zero-length word; tags route replies.
function sentence(...words: string[]): Buffer {
  return Buffer.concat([
    ...words.flatMap(word => {
      const value = Buffer.from(word);
      assert.ok(value.length < 128);
      return [Buffer.from([value.length]), value];
    }),
    Buffer.from([0]),
  ]);
}

function harness() {
  const receiver = new Receiver(new EventEmitter() as never);
  const connector = {
    read: receiver.read.bind(receiver),
    stopRead: receiver.stop.bind(receiver),
    write() {},
  };
  const open = () => {
    const channel = new Channel(connector as never);
    const result = channel.write(["/ip/hotspot/user/profile/print"]);
    return { channel, result };
  };
  const reply = (tag: string, ...words: string[]) =>
    receiver.processRawData(sentence(...words, `.tag=${tag}`));
  return { receiver, open, reply };
}

test("!empty leaves the tag registered until the separate !done reply", async () => {
  const { open, reply } = harness();
  const { channel, result } = open();
  let closed = false;
  let resolved = false;
  channel.once("close", () => { closed = true; });
  void result.then(() => { resolved = true; });
  reply(channel.Id, "!empty");
  await Promise.resolve();
  assert.equal(closed, false);
  assert.equal(resolved, false);
  reply(channel.Id, "!done");
  assert.deepEqual(await result, []);
  assert.equal(closed, true);
});

test("coalesced !empty and !done do not dispatch to an unregistered tag", async () => {
  const { receiver, open } = harness();
  const { channel, result } = open();
  const wire = Buffer.concat([
    sentence("!empty", `.tag=${channel.Id}`),
    sentence("!done", `.tag=${channel.Id}`),
  ]);
  receiver.processRawData(wire);
  assert.deepEqual(await result, []);
});

test("fragmented empty replies and interleaved concurrent commands preserve tags", async () => {
  const { receiver, open, reply } = harness();
  const first = open();
  const second = open();
  const wire = sentence("!empty", `.tag=${first.channel.Id}`);
  for (const byte of wire) receiver.processRawData(Buffer.from([byte]));
  reply(second.channel.Id, "!re", "=.id=*1", "=name=paid-plan");
  reply(second.channel.Id, "!done");
  reply(first.channel.Id, "!done");
  assert.deepEqual(await first.result, []);
  assert.deepEqual(await second.result, [{ ".id": "*1", name: "paid-plan" }]);
});

test("RouterOS traps still reject and their final !done safely closes the channel", async () => {
  const { open, reply } = harness();
  const { channel, result } = open();
  const rejected = assert.rejects(result, /permission denied/);
  reply(channel.Id, "!trap", "=message=permission denied");
  reply(channel.Id, "!done");
  await rejected;
});