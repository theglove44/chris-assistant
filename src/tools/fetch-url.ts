import { z } from "zod";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { registerTool } from "./registry.js";
import { checkSsrf } from "./ssrf.js";

const MAX_CONTENT_LENGTH = 50_000;
const FETCH_TIMEOUT_MS = 15_000;

function stripHtml(html: string): string {
  // Remove <script>...</script> blocks entirely (including content)
  // Note: closing tags use string concat to avoid esbuild misinterpreting </ as script close
  let text = html.replace(new RegExp("<script\\b[^>]*>[\\s\\S]*?<" + "/script>", "gi"), "");
  // Remove <style>...</style> blocks entirely (including content)
  text = text.replace(new RegExp("<style\\b[^>]*>[\\s\\S]*?<" + "/style>", "gi"), "");
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

function extractWithReadability(html: string, url: string): string | null {
  try {
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as Document).parse();
    const text = article?.textContent?.trim();
    return text ? text : null;
  } catch {
    return null;
  }
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

    const ssrfError = await checkSsrf(url);
    if (ssrfError !== null) {
      console.warn("[fetch-url] SSRF blocked: %s", url);
      return ssrfError;
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

      // Reject binary content early — reading it as text produces garbage and
      // wastes context window. Return a clear error so the model doesn't try
      // to interpret binary bytes as meaningful text.
      const binaryPrefixes = ["image/", "audio/", "video/", "application/octet-stream", "application/pdf"];
      if (binaryPrefixes.some((p) => contentType.startsWith(p))) {
        console.log("[fetch-url] Skipped binary content (%s): %s", contentType, url);
        return `Cannot fetch ${url}: this is a binary image file (${contentType}). You already have direct vision access to any image the user sent — describe it using your built-in vision capabilities without fetching its URL.`;
      }

      const rawText = await res.text();

      let content: string;
      if (contentType.includes("text/html")) {
        // Try Readability first for clean article extraction, fall back to regex
        const readabilityResult = extractWithReadability(rawText, url);
        if (readabilityResult !== null) {
          content = readabilityResult;
          console.log("[fetch-url] Extracted via readability (%d chars)", content.length);
        } else {
          content = stripHtml(rawText);
          console.log("[fetch-url] Extracted via stripHtml (%d chars)", content.length);
        }
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
