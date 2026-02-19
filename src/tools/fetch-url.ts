import { z } from "zod";
import { registerTool } from "./registry.js";

const MAX_CONTENT_LENGTH = 50_000;
const FETCH_TIMEOUT_MS = 15_000;

function stripHtml(html: string): string {
  // Remove <script>...</script> blocks entirely (including content)
  let text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  // Remove <style>...</style> blocks entirely (including content)
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  // Collapse multiple whitespace and newlines into single newlines
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n+/g, "\n\n");
  return text.trim();
}

registerTool({
  name: "fetch_url",
  description:
    "Fetch the content of a URL. Use this to read web pages, articles, API endpoints, or any URL the user pastes in chat. Returns the text content of the page.",
  zodSchema: {
    url: z.string().describe("The URL to fetch"),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["url"],
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch",
      },
    },
  },
  execute: async (args: { url: string }): Promise<string> => {
    const { url } = args;

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return `Error: Invalid URL "${url}" — must start with http:// or https://`;
    }

    console.log("[fetch-url] Fetching: %s", url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "chris-assistant/1.0",
        },
      });

      if (!res.ok) {
        console.error("[fetch-url] HTTP error (%d): %s", res.status, url);
        return `Error fetching ${url}: HTTP ${res.status} ${res.statusText}`;
      }

      const contentType = res.headers.get("content-type") ?? "";
      const rawText = await res.text();

      let content: string;
      if (contentType.includes("text/html")) {
        content = stripHtml(rawText);
      } else {
        content = rawText;
      }

      if (content.length > MAX_CONTENT_LENGTH) {
        content = content.slice(0, MAX_CONTENT_LENGTH) + "\n[... truncated ...]";
      }

      console.log(
        "[fetch-url] Fetched %d chars from: %s",
        content.length,
        url
      );
      return content;
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.error("[fetch-url] Timeout fetching: %s", url);
        return `Error fetching ${url}: Request timed out after ${FETCH_TIMEOUT_MS / 1000} seconds`;
      }
      console.error("[fetch-url] Error fetching %s: %s", url, err.message);
      return `Error fetching ${url}: ${err.message}`;
    } finally {
      clearTimeout(timer);
    }
  },
});

console.log("[tools] fetch_url registered");
