import { Channel } from "node-routeros";

type ChannelPacketHandler = {
  processPacket(packet: string[]): void;
};

/*
 * RouterOS 7.18 introduced !empty as a reply for commands with no
 * data. node-routeros 1.6.9 (the latest published release) treats it as an
 * unknown reply and throws from an EventEmitter callback, which can terminate
 * the API process. !done is still the final reply for every command. Ignore
 * the empty-data marker and keep the channel registered until !done arrives;
 * treating !empty as !done closes the tag too early and crashes the receiver.
 */
const channelPrototype = Channel.prototype as unknown as ChannelPacketHandler;
const processPacket = channelPrototype.processPacket;

channelPrototype.processPacket = function (packet: string[]) {
  if (packet[0] === "!empty") {
    return;
  }

  return processPacket.call(this, packet);
};