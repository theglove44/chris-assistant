import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return { ...actual, default: { ...actual, request: requestMock }, request: requestMock };
});

vi.mock("node:https", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:https")>();
  return { ...actual, default: { ...actual, request: requestMock }, request: requestMock };
});

import { safeGet } from "../src/tools/safe-http.js";

describe("safeGet redirects", () => {
  beforeEach(() => requestMock.mockReset());

  it("blocks a redirect to a private destination before opening the next socket", async () => {
    requestMock.mockImplementation((_url, _options, onResponse) => {
      const request = new EventEmitter() as EventEmitter & { end(): void };
      request.end = () => {
        const response = Object.assign(new EventEmitter(), {
          statusCode: 302,
          statusMessage: "Found",
          headers: { location: "http://127.0.0.1/metadata" },
          resume: vi.fn(),
        });
        onResponse(response);
      };
      return request;
    });

    const resolver = async () => [{ address: "93.184.216.34", family: 4 as const }];
    await expect(safeGet("https://public.example/start", { resolver })).rejects.toThrow("private/internal");
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});
