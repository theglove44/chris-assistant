import { describe, expect, it } from "vitest";
import {
  checkSsrf,
  createSafeLookup,
  isPrivateIp,
  type AddressResolver,
} from "../src/tools/ssrf.js";

describe("outbound URL address safety", () => {
  it.each([
    "127.0.0.1",
    "100.64.0.1",
    "192.0.2.1",
    "224.0.0.1",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:1",
    "64:ff9b:1::1",
    "2002:7f00:1::",
  ])("blocks special address %s", (address) => {
    expect(isPrivateIp(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888", "::ffff:8.8.8.8"])(
    "allows public address %s",
    (address) => expect(isPrivateIp(address)).toBe(false),
  );

  it("rejects a hostname if any DNS answer is non-public", async () => {
    const resolver: AddressResolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];

    await expect(checkSsrf("https://example.test", resolver)).resolves.toContain("private/internal");
  });

  it("revalidates the DNS result used by the socket", async () => {
    let lookupCount = 0;
    const resolver: AddressResolver = async () => {
      lookupCount += 1;
      return lookupCount === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }];
    };

    await expect(checkSsrf("https://rebind.test", resolver)).resolves.toBeNull();
    const lookup = createSafeLookup(resolver);
    await expect(new Promise((resolve, reject) => {
      lookup("rebind.test", { family: 0 }, (error, address) => error ? reject(error) : resolve(address));
    })).rejects.toThrow("private/internal");
  });

  it("rejects non-HTTP schemes and credential-bearing URLs", async () => {
    await expect(checkSsrf("file:///etc/passwd")).resolves.toContain("Only unauthenticated HTTP(S)");
    await expect(checkSsrf("https://user:pass@example.com")).resolves.toContain("Only unauthenticated HTTP(S)");
  });
});
