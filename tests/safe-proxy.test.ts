import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startSafeProxy, type SafeProxy } from "../src/tools/safe-proxy.js";

describe("safe browser proxy", () => {
  let proxy: SafeProxy | null = null;

  afterEach(async () => {
    await proxy?.close();
    proxy = null;
  });

  it("rejects a CONNECT tunnel whose actual target is private", async () => {
    proxy = await startSafeProxy();
    const endpoint = new URL(proxy.url);

    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(Number(endpoint.port), endpoint.hostname);
      let received = "";
      socket.setEncoding("utf8");
      socket.once("connect", () => socket.write("CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n"));
      socket.on("data", (chunk) => { received += chunk; });
      socket.once("end", () => resolve(received));
      socket.once("error", reject);
    });

    expect(response).toContain("502 Bad Gateway");
  });
});
