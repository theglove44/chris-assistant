import { describe, expect, it, vi } from "vitest";
import { scrapeFirecrawl, searchFirecrawl } from "../src/tools/firecrawl-client.js";

describe("Firecrawl client", () => {
  it("maps search options to the v2 API and returns web results", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        web: [{ title: "Result", description: "Summary", url: "https://example.com" }],
      },
    }), { status: 200 }));

    const results = await searchFirecrawl("test-key", {
      query: "latest TypeScript",
      count: 5,
      freshness: "pw",
      country: "UK",
      location: "London,England,United Kingdom",
    }, fetchMock as unknown as typeof fetch);

    expect(results).toEqual([
      { title: "Result", description: "Summary", url: "https://example.com" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v2/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          query: "latest TypeScript",
          limit: 5,
          tbs: "qdr:w",
          country: "UK",
          location: "London,England,United Kingdom",
        }),
      }),
    );
  });

  it("requests clean Markdown from the v2 scrape API", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        markdown: "# Example",
        metadata: { title: "Example", sourceURL: "https://example.com" },
      },
    }), { status: 200 }));

    const result = await scrapeFirecrawl(
      "test-key",
      "https://example.com",
      fetchMock as unknown as typeof fetch,
    );

    expect(result.markdown).toBe("# Example");
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      url: "https://example.com",
      formats: ["markdown"],
      onlyMainContent: true,
      removeBase64Images: true,
      blockAds: true,
    });
  });

  it("surfaces a concise API error without exposing the key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: false,
      error: "Unauthorized: Invalid token",
    }), { status: 401 }));

    await expect(searchFirecrawl(
      "super-secret-key",
      { query: "test", count: 1 },
      fetchMock as unknown as typeof fetch,
    )).rejects.toThrow("Firecrawl API returned HTTP 401: Unauthorized: Invalid token");
    await expect(searchFirecrawl(
      "super-secret-key",
      { query: "test", count: 1 },
      fetchMock as unknown as typeof fetch,
    )).rejects.not.toThrow("super-secret-key");
  });
});
