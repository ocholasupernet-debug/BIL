import { Channel } from "node-routeros";

type ChannelPacketHandler = {
  processPacket(packet: string[]): void;
};

/*
 * RouterOS 7.18 introduced !empty as the terminal reply for commands with no
 * data. node-routeros 1.6.9 (the latest published release) treats it as an
 * unknown reply and throws from an EventEmitter callback, which can terminate
 * the API process. It has the same empty-result meaning as !done, so normalize
 * only this reply before the library processes it.
 */
const channelPrototype = Channel.prototype as unknown as ChannelPacketHandler;
const processPacket = channelPrototype.processPacket;

channelPrototype.processPacket = function (packet: string[]) {
  if (packet[0] === "!empty") {
    packet[0] = "!done";
  }

  return processPacket.call(this, packet);
};