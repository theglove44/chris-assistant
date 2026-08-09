import http from "node:http";
import net from "node:net";
import { assertSafeUrl, createSafeLookup, parseHttpUrl } from "./ssrf.js";

export interface SafeProxy {
  url: string;
  close(): Promise<void>;
}

function proxyHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const result = { ...headers };
  delete result["proxy-authorization"];
  delete result["proxy-connection"];
  delete result.connection;
  return result;
}

export async function startSafeProxy(): Promise<SafeProxy> {
  const server = http.createServer((incoming, outgoing) => {
    void (async () => {
      let target: URL;
      try {
        target = parseHttpUrl(incoming.url ?? "");
        if (target.protocol !== "http:") throw new Error("HTTPS requests must use CONNECT");
        await assertSafeUrl(target.toString());
      } catch {
        outgoing.writeHead(400).end("Invalid proxy target");
        return;
      }

      const upstream = http.request(target, {
        method: incoming.method,
        headers: proxyHeaders(incoming.headers),
        lookup: createSafeLookup(),
      }, (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.statusMessage, response.headers);
        response.pipe(outgoing);
      });
      upstream.on("error", () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end("Blocked or unavailable upstream");
      });
      incoming.pipe(upstream);
    })();
  });

  server.on("connect", (request, clientSocket, head) => {
    void (async () => {
      let target: URL;
      try {
        target = new URL(`http://${request.url}`);
        if (!target.hostname || !target.port) throw new Error("Missing CONNECT port");
        await assertSafeUrl(target.toString());
      } catch {
        clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        return;
      }

      const hostname = target.hostname.startsWith("[") ? target.hostname.slice(1, -1) : target.hostname;
      const upstream = net.connect({
        host: hostname,
        port: Number(target.port),
        lookup: createSafeLookup(),
      });
      upstream.once("connect", () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.once("error", () => clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
      clientSocket.once("error", () => upstream.destroy());
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Safe proxy did not bind to TCP");

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
