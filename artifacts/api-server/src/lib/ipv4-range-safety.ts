export type Ipv4Range = { start: number; end: number };

export function ipv4AddressNumber(value: string): number | null {
  const parts = value.trim().split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  if (octets.some(octet => octet < 0 || octet > 255)) return null;
  return octets[0] * 16_777_216 + octets[1] * 65_536 + octets[2] * 256 + octets[3];
}

export function parseIpv4Ranges(value: string): Ipv4Range[] {
  if (!value.trim()) return [];
  return value.split(",").map(part => {
    const item = part.trim();
    const cidr = /^(.+)\/(\d{1,2})$/.exec(item);
    if (cidr) {
      const address = ipv4AddressNumber(cidr[1]);
      const prefix = Number(cidr[2]);
      if (address === null || prefix < 0 || prefix > 32) {
        throw new Error(`Invalid IPv4 subnet: ${item}`);
      }
      const size = 2 ** (32 - prefix);
      const start = Math.floor(address / size) * size;
      return { start, end: start + size - 1 };
    }
    const range = /^(.+)-(.+)$/.exec(item);
    if (range) {
      const start = ipv4AddressNumber(range[1]);
      const end = ipv4AddressNumber(range[2]);
      if (start === null || end === null || start > end) {
        throw new Error(`Invalid IPv4 address range: ${item}`);
      }
      return { start, end };
    }
    const address = ipv4AddressNumber(item);
    if (address === null) throw new Error(`Invalid IPv4 address or range: ${item}`);
    return { start: address, end: address };
  });
}

export function ipv4RangesOverlap(left: Ipv4Range, right: Ipv4Range): boolean {
  return left.start <= right.end && right.start <= left.end;
}
