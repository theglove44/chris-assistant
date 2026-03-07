import { z } from "zod";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { registerTool } from "./registry.js";
import { checkSsrf } from "./ssrf.js";

const MAX_CONTENT_LENGTH = 50_000;
const NAVIGATE_TIMEOUT_MS = 30_000;
const IDLE_SHUTDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Lazy browser singleton — launched on first call, killed after idle timeout
let browserInstance: import("playwright").Browser | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

async function getBrowser(): Promise<import("playwright").Browser> {
  if (browserInstance?.isConnected()) {
    resetIdleTimer();
    return browserInstance;
  }

  console.log("[browse-url] Launching Chromium...");
  const { chromium } = await import("playwright");
  browserInstance = await chromium.launch({ headless: true });
  console.log("[browse-url] Chromium launched");
  resetIdleTimer();
  return browserInstance;
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (browserInstance) {
      console.log("[browse-url] Idle timeout — closing browser");
      await browserInstance.close().catch(() => {});
      browserInstance = null;
    }
  }, IDLE_SHUTDOWN_MS);
}

function extractWithReadability(html: string, url: string): string | null {
  try {
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as Document).parse();
    const text = article?.textContent?.trim();
    return text || null;
  } catch {
    return null;
  }
}

registerTool({
  name: "browse_url",
  description:
    "Browse a URL using a headless browser with full JavaScript rendering. Use when fetch_url returns empty or broken content, or for JavaScript-heavy sites (SPAs, React apps, dynamic pages). Slower than fetch_url — prefer fetch_url for static content.",
  zodSchema: {
    url: z.string().describe("The URL to browse"),
    waitFor: z.string().optional().describe("Optional CSS selector to wait for before extracting content (useful for SPAs)"),
  },
  jsonSchemaParameters: {
    type: "object",
    required: ["url"],
    properties: {
      url: {
        type: "string",
        description: "The URL to browse",
      },
      waitFor: {
        type: "string",
        description: "Optional CSS selector to wait for before extracting content (useful for SPAs)",
      },
    },
  },
  execute: async (args: { url: string; waitFor?: string }): Promise<string> => {
    const { url, waitFor } = args;

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return `Error: Invalid URL "${url}" — must start with http:// or https://`;
    }

    const ssrfError = await checkSsrf(url);
    if (ssrfError !== null) {
      console.warn("[browse-url] SSRF blocked: %s", url);
      return ssrfError;
    }

    console.log("[browse-url] Browsing: %s", url);

    let browser: import("playwright").Browser;
    try {
      browser = await getBrowser();
    } catch (err: any) {
      console.error("[browse-url] Failed to launch browser: %s", err.message);
      return `Error: Could not launch browser. Is Playwright installed? Run: npx playwright install chromium\n\n${err.message}`;
    }

    const context = await browser.newContext({
      userAgent: "chris-assistant/1.0",
    });
    const page = await context.newPage();

    try {
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: NAVIGATE_TIMEOUT_MS,
      });

      if (waitFor) {
        await page.waitForSelector(waitFor, { timeout: 10_000 }).catch(() => {
          console.log("[browse-url] waitFor selector '%s' not found, continuing", waitFor);
        });
      }

      const html = await page.content();

      // Try Readability first, but reject if it returns suspiciously little
      // content (e.g. just a legal disclaimer instead of the real article)
      let content = extractWithReadability(html, url);
      const MIN_READABILITY_CHARS = 500;
      if (!content || content.length < MIN_READABILITY_CHARS) {
        if (content) {
          console.log("[browse-url] Readability returned only %d chars, falling back", content.length);
        }
        // Strip nav/header/footer/aside, then extract innerText from body
        content = await page.evaluate(() => {
          const selectors = ["nav", "header", "footer", "aside", "[role=navigation]", "[role=banner]", "[role=contentinfo]"];
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach((el) => el.remove());
          }
          return document.body?.innerText || "";
        });
        content = content.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
      }

      if (content.length > MAX_CONTENT_LENGTH) {
        content = content.slice(0, MAX_CONTENT_LENGTH) + "\n[... truncated ...]";
      }

      console.log("[browse-url] Extracted %d chars from: %s", content.length, url);
      return content || "Page loaded but no text content was found.";
    } catch (err: any) {
      console.error("[browse-url] Error browsing %s: %s", url, err.message);
      return `Error browsing ${url}: ${err.message}`;
    } finally {
      await context.close().catch(() => {});
    }
  },
});

console.log("[tools] browse_url registered");
