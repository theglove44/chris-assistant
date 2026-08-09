import { z } from "zod";
import { LIMITS } from "../infra/config/limits.js";
import { scrapeFirecrawl } from "./firecrawl-client.js";
import { registerTool } from "./registry.js";
import { checkSsrf } from "./ssrf.js";

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

if (FIRECRAWL_API_KEY) {
  registerTool({
    name: "scrape_url",
    description:
      "Scrape a public web page with Firecrawl and return clean Markdown. Use after web_search, or when fetch_url cannot extract a page reliably.",
    zodSchema: {
      url: z.string().describe("The public HTTP(S) URL to scrape"),
    },
    jsonSchemaParameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: "The public HTTP(S) URL to scrape",
        },
      },
    },
    execute: async ({ url }: { url: string }): Promise<string> => {
      const unsafeReason = await checkSsrf(url);
      if (unsafeReason) return unsafeReason;

      console.log("[scrape-url] Scraping: %s", url);
      try {
        const result = await scrapeFirecrawl(FIRECRAWL_API_KEY, url);
        const markdown = result.markdown?.trim();
        if (!markdown) return `No readable content found at ${url}.`;

        const title = result.metadata?.title?.trim();
        const sourceUrl = result.metadata?.sourceURL || result.metadata?.url || url;
        let output = `${title ? `# ${title}\n\n` : ""}Source: ${sourceUrl}\n\n${markdown}`;
        if (output.length > LIMITS.maxToolOutput) {
          output = `${output.slice(0, LIMITS.maxToolOutput)}\n[... truncated ...]`;
        }
        return output;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Firecrawl error";
        console.error("[scrape-url] Error:", message);
        return `Scrape failed: ${message}`;
      }
    },
  });
  console.log("[tools] scrape_url registered (Firecrawl Scrape API)");
} else {
  console.log("[tools] scrape_url not registered (FIRECRAWL_API_KEY not set)");
}
