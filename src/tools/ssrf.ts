import { promises as dns } from "dns";

export function isPrivateIp(ip: string): boolean {
  // IPv4 checks
  const parts = ip.split(".").map(Number);
  if (parts.length === 4 && parts.every((p) => !isNaN(p))) {
    if (parts[0] === 127) return true;                                        // 127.0.0.0/8 loopback
    if (parts[0] === 10) return true;                                         // 10.0.0.0/8 private
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;   // 172.16.0.0/12 private
    if (parts[0] === 192 && parts[1] === 168) return true;                    // 192.168.0.0/16 private
    if (parts[0] === 169 && parts[1] === 254) return true;                    // 169.254.0.0/16 link-local / cloud metadata
    if (parts[0] === 0) return true;                                          // 0.0.0.0/8 current network
    return false;
  }
  // IPv6 checks
  if (ip === "::1") return true;                                              // IPv6 loopback
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true;               // fc00::/7 unique local
  if (ip.startsWith("fe80")) return true;                                     // fe80::/10 link-local
  return false;
}

export async function checkSsrf(url: string): Promise<string | null> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return `Error: Invalid URL "${url}"`;
  }

  // Strip IPv6 brackets if present (e.g. [::1] → ::1)
  const normalizedHost = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  // Block localhost and IPv6 loopback hostnames directly, before any DNS lookup
  if (normalizedHost === "localhost" || normalizedHost === "::1") {
    return "Error: URL does not allow requests to private/internal addresses";
  }

  // If the hostname is already a bare IP address, check it directly
  if (isPrivateIp(normalizedHost)) {
    return "Error: URL does not allow requests to private/internal addresses";
  }

  // Resolve the hostname via DNS and check the result
  try {
    const { address } = await dns.lookup(normalizedHost);
    if (isPrivateIp(address)) {
      return "Error: URL does not allow requests to private/internal addresses";
    }
  } catch {
    // DNS failure means the fetch will fail too — let it proceed and surface
    // a natural network error rather than silently swallowing the attempt
  }

  return null;
}
