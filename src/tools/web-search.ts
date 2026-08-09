import { z } from "zod";
import { registerTool } from "./registry.js";
import { searchFirecrawl } from "./firecrawl-client.js";

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

// Only register if API key is available
if (FIRECRAWL_API_KEY) {
  registerTool({
    name: "web_search",
    description: `Search the web with Firecrawl for current information. Returns numbered results with URLs — use scrape_url to extract clean Markdown from a result. Supports optional count (1-10), freshness filter (pd/pw/pm/py), country code, and location.`,
    zodSchema: {
      query: z.string().describe("The search query"),
      count: z.number().min(1).max(10).optional().describe("Number of results to return (1-10, default 8)"),
      freshness: z.enum(["pd", "pw", "pm", "py"]).optional().describe("Filter by recency: pd (past day), pw (past week), pm (past month), py (past year)"),
      country: z.string().optional().describe("ISO country code for search results (e.g. US, UK, DE)"),
      location: z.string().optional().describe("Location for geo-targeted results (e.g. London,England,United Kingdom)"),
    },
    jsonSchemaParameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
        count: {
          type: "number",
          minimum: 1,
          maximum: 10,
          description: "Number of results to return (1-10, default 8)",
        },
        freshness: {
          type: "string",
          enum: ["pd", "pw", "pm", "py"],
          description: "Filter by recency: pd (past day), pw (past week), pm (past month), py (past year)",
        },
        country: {
          type: "string",
          description: "ISO country code for search results (e.g. US, UK, DE)",
        },
        location: {
          type: "string",
          description: "Location for geo-targeted results (e.g. London,England,United Kingdom)",
        },
      },
    },
    execute: async (args: { query: string; count?: number; freshness?: "pd" | "pw" | "pm" | "py"; country?: string; location?: string }): Promise<string> => {
      const { query, count = 8, freshness, country, location } = args;
      const effectiveCount = Math.min(10, Math.max(1, Math.trunc(count)));
      console.log("[web-search] Searching: %s", query);

      try {
        const results = await searchFirecrawl(FIRECRAWL_API_KEY, {
          query,
          count: effectiveCount,
          freshness,
          country,
          location,
        });

        if (results.length === 0) {
          return `No results found for "${query}".`;
        }

        const formatted = results.slice(0, effectiveCount).map((r, i) => {
          const title = r.title || "Untitled";
          const resultUrl = r.url || "";
          const snippet = r.description || "";

          let entry = `${i + 1}. **${title}**\n   URL: ${resultUrl}`;
          if (snippet) entry += `\n   ${snippet}`;
          return entry;
        }).join("\n\n");

        console.log("[web-search] Got %d results for: %s", results.length, query);
        return `Search results for "${query}":\n\n${formatted}\n\n---\nTip: Use scrape_url on any result URL for clean page content.`;
      } catch (err: any) {
        console.error("[web-search] Error:", err.message);
        return `Search failed: ${err.message}`;
      }
    },
  });
  console.log("[tools] web_search registered (Firecrawl Search API)");
} else {
  console.log("[tools] web_search not registered (FIRECRAWL_API_KEY not set)");
}
