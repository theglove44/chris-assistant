import { z } from "zod";
import { registerTool } from "./registry.js";

const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY;

// Only register if API key is available
if (BRAVE_API_KEY) {
  registerTool({
    name: "web_search",
    description: `Search the web for current information. Use this when you need to look up real-time data like news, weather, prices, facts, or anything that may have changed after your training cutoff. Returns the top 5 search results with titles, URLs, and snippets.`,
    zodSchema: {
      query: z.string().describe("The search query"),
    },
    jsonSchemaParameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
      },
    },
    execute: async (args: { query: string }): Promise<string> => {
      const { query } = args;
      console.log("[web-search] Searching: %s", query);

      try {
        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", query);
        url.searchParams.set("count", "5");

        const res = await fetch(url.toString(), {
          headers: {
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": BRAVE_API_KEY!,
          },
        });

        if (!res.ok) {
          const text = await res.text();
          console.error("[web-search] API error (%d): %s", res.status, text.slice(0, 200));
          return `Search failed (HTTP ${res.status}). Try again.`;
        }

        const data = await res.json() as any;
        const results = data.web?.results;

        if (!results || results.length === 0) {
          return `No results found for "${query}".`;
        }

        // Format results as readable text for the AI
        const formatted = results.slice(0, 5).map((r: any, i: number) => {
          const title = r.title || "Untitled";
          const url = r.url || "";
          const snippet = r.description || "";
          return `${i + 1}. ${title}\n   ${url}\n   ${snippet}`;
        }).join("\n\n");

        console.log("[web-search] Got %d results for: %s", results.length, query);
        return `Search results for "${query}":\n\n${formatted}`;
      } catch (err: any) {
        console.error("[web-search] Error:", err.message);
        return `Search failed: ${err.message}`;
      }
    },
  });
  console.log("[tools] web_search registered (Brave Search API)");
} else {
  console.log("[tools] web_search not registered (BRAVE_SEARCH_API_KEY not set)");
}
