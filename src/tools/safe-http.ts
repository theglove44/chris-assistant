import http from "node:http";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { assertSafeUrl, createSafeLookup, type AddressResolver } from "./ssrf.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

export interface SafeHttpResponse {
  status: number;
  statusText: string;
  headers: IncomingHttpHeaders;
  finalUrl: string;
  text(): Promise<string>;
}

export async function safeGet(
  rawUrl: string,
  options: { signal?: AbortSignal; headers?: Record<string, string>; resolver?: AddressResolver } = {},
  redirectCount = 0,
): Promise<SafeHttpResponse> {
  const url = await assertSafeUrl(rawUrl, options.resolver);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: "GET",
      headers: options.headers,
      signal: options.signal,
      lookup: createSafeLookup(options.resolver),
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (REDIRECT_STATUSES.has(status) && location) {
        response.resume();
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error(`Too many redirects (maximum ${MAX_REDIRECTS})`));
          return;
        }
        const nextUrl = new URL(location, url).toString();
        safeGet(nextUrl, options, redirectCount + 1).then(resolve, reject);
        return;
      }

      resolve({
        status,
        statusText: response.statusMessage ?? "",
        headers: response.headers,
        finalUrl: url.toString(),
        text: async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of response) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          return Buffer.concat(chunks).toString("utf8");
        },
      });
    });
    request.on("error", reject);
    request.end();
  });
}
