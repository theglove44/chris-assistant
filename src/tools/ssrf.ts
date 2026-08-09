import dns, { type LookupAddress } from "node:dns";
import { isIP } from "node:net";

const BLOCKED_MESSAGE = "Error: URL does not allow requests to private/internal addresses";

export type AddressResolver = (hostname: string) => Promise<LookupAddress[]>;
type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

const defaultResolver: AddressResolver = (hostname) =>
  dns.promises.lookup(hostname, { all: true, verbatim: true });

function ipv4Number(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

function inIpv4Cidr(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function ipv6Bytes(ip: string): number[] | null {
  const withoutZone = ip.split("%")[0].toLowerCase();
  let normalized = withoutZone;
  const ipv4Match = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const value = ipv4Number(ipv4Match[1]);
    if (value === null) return null;
    normalized = normalized.slice(0, -ipv4Match[1].length)
      + ((value >>> 16) & 0xffff).toString(16)
      + ":"
      + (value & 0xffff).toString(16);
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >>> 8, value & 0xff];
  });
}

function hasPrefix(bytes: number[], prefix: number[], bits: number): boolean {
  const wholeBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;
  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = 0xff << (8 - remainingBits);
  return (bytes[wholeBytes] & mask) === (prefix[wholeBytes] & mask);
}

function ipv6Prefix(cidrAddress: string): number[] {
  const bytes = ipv6Bytes(cidrAddress);
  if (!bytes) throw new Error(`Invalid internal IPv6 range: ${cidrAddress}`);
  return bytes;
}

const BLOCKED_IPV4: Array<[number, number]> = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
  [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
  [0xc0586300, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24],
  [0xcb007100, 24], [0xe0000000, 4], [0xf0000000, 4],
];

const BLOCKED_IPV6: Array<[number[], number]> = [
  [ipv6Prefix("::"), 96],                 // unspecified, IPv4-compatible and mapped forms
  [ipv6Prefix("64:ff9b::"), 96],         // well-known NAT64 prefix
  [ipv6Prefix("64:ff9b:1::"), 48],       // local-use NAT64 prefix
  [ipv6Prefix("100::"), 64],             // discard-only
  [ipv6Prefix("2001::"), 23],            // IETF protocol assignments/documentation
  [ipv6Prefix("2002::"), 16],            // 6to4 (can encode private IPv4)
  [ipv6Prefix("fc00::"), 7],             // unique-local
  [ipv6Prefix("fe80::"), 10],            // link-local
  [ipv6Prefix("fec0::"), 10],            // deprecated site-local
  [ipv6Prefix("ff00::"), 8],             // multicast
];

export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const value = ipv4Number(ip);
    return value === null || BLOCKED_IPV4.some(([base, prefix]) => inIpv4Cidr(value, base, prefix));
  }
  if (family !== 6) return true;
  const bytes = ipv6Bytes(ip);
  if (!bytes) return true;

  // IPv4-mapped IPv6 must be judged by the embedded IPv4 address, not by its text form.
  const mappedPrefix = ipv6Prefix("::ffff:0:0");
  if (hasPrefix(bytes, mappedPrefix, 96)) {
    return isPrivateIp(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }
  return BLOCKED_IPV6.some(([prefix, bits]) => hasPrefix(bytes, prefix, bits));
}

export function parseHttpUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Only unauthenticated HTTP(S) URLs are allowed");
  }
  return url;
}

function normalizedHostname(url: URL): string {
  return url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
}

export async function resolvePublicAddresses(
  hostname: string,
  resolver: AddressResolver = defaultResolver,
): Promise<LookupAddress[]> {
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await resolver(hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error(BLOCKED_MESSAGE);
  }
  return addresses;
}

export function createSafeLookup(resolver: AddressResolver = defaultResolver): typeof dns.lookup {
  return ((hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    resolvePublicAddresses(hostname, resolver)
      .then((addresses) => {
        const requestedFamily = typeof options === "object" ? options.family : 0;
        const candidates = requestedFamily ? addresses.filter(({ family }) => family === requestedFamily) : addresses;
        if (candidates.length === 0) throw new Error(`No public address found for ${hostname}`);
        if (typeof options === "object" && options.all) {
          callback(null, candidates);
        } else {
          callback(null, candidates[0].address, candidates[0].family);
        }
      })
      .catch((error: NodeJS.ErrnoException) => callback(error, "", 0));
  }) as typeof dns.lookup;
}

export async function assertSafeUrl(rawUrl: string, resolver: AddressResolver = defaultResolver): Promise<URL> {
  const url = parseHttpUrl(rawUrl);
  const hostname = normalizedHostname(url).toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error(BLOCKED_MESSAGE);
  await resolvePublicAddresses(hostname, resolver);
  return url;
}

export async function checkSsrf(url: string, resolver: AddressResolver = defaultResolver): Promise<string | null> {
  try {
    await assertSafeUrl(url, resolver);
    return null;
  } catch (error) {
    if (error instanceof TypeError) return `Error: Invalid URL "${url}"`;
    return error instanceof Error && error.message.startsWith("Error:")
      ? error.message
      : `Error: ${error instanceof Error ? error.message : "URL validation failed"}`;
  }
}
