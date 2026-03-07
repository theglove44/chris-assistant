import { z } from "zod";
import { registerTool } from "./registry.js";

const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY;

// Only register if API key is available
if (BRAVE_API_KEY) {
  registerTool({
    name: "web_search",
    description: `Search the web for current information. Use this when you need to look up real-time data like news, weather, prices, facts, or anything that may have changed after your training cutoff. Returns numbered results with URLs — you can then use fetch_url or browse_url to read individual results for deeper research. Supports optional count (1-10), freshness filter (pd/pw/pm/py), and country code.`,
    zodSchema: {
      query: z.string().describe("The search query"),
      count: z.number().min(1).max(10).optional().describe("Number of results to return (1-10, default 8)"),
      freshness: z.enum(["pd", "pw", "pm", "py"]).optional().describe("Filter by recency: pd (past day), pw (past week), pm (past month), py (past year)"),
      country: z.string().optional().describe("Country code for search results (e.g. US, GB, DE)"),
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
          description: "Country code for search results (e.g. US, GB, DE)",
        },
      },
    },
    execute: async (args: { query: string; count?: number; freshness?: "pd" | "pw" | "pm" | "py"; country?: string }): Promise<string> => {
      const { query, count = 8, freshness, country } = args;
      console.log("[web-search] Searching: %s", query);

      try {
        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", query);
        url.searchParams.set("count", String(count));
        url.searchParams.set("extra_snippets", "true");
        if (freshness) url.searchParams.set("freshness", freshness);
        if (country) url.searchParams.set("country", country);

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

        const formatted = results.slice(0, count).map((r: any, i: number) => {
          const title = r.title || "Untitled";
          const resultUrl = r.url || "";
          const snippet = r.description || "";
          const age = r.age || "";
          const extraSnippets: string[] = r.extra_snippets || [];

          let entry = `${i + 1}. **${title}**\n   URL: ${resultUrl}`;
          if (age) entry += `\n   Date: ${age}`;
          entry += `\n   ${snippet}`;
          if (extraSnippets.length > 0) {
            entry += `\n   ${extraSnippets.join(" … ")}`;
          }
          return entry;
        }).join("\n\n");

        console.log("[web-search] Got %d results for: %s", results.length, query);
        return `Search results for "${query}":\n\n${formatted}\n\n---\nTip: Use fetch_url or browse_url on any result URL for the full page content.`;
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
