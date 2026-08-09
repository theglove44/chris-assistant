const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v2";
const FIRECRAWL_TIMEOUT_MS = 65_000;

export interface FirecrawlSearchResult {
  title?: string;
  description?: string;
  url?: string;
  markdown?: string;
}

export interface FirecrawlScrapeResult {
  markdown?: string;
  metadata?: {
    title?: string;
    description?: string;
    sourceURL?: string;
    url?: string;
  };
}

type FetchLike = typeof fetch;

async function firecrawlPost<T>(
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FIRECRAWL_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${FIRECRAWL_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload: any = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      // Preserve the HTTP status below without echoing an arbitrary HTML body.
    }

    if (!response.ok || payload?.success === false) {
      const detail = typeof payload?.error === "string" ? `: ${payload.error}` : "";
      throw new Error(`Firecrawl API returned HTTP ${response.status}${detail}`);
    }
    if (!payload?.data) {
      throw new Error("Firecrawl API returned an unexpected response");
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Firecrawl API timed out after ${FIRECRAWL_TIMEOUT_MS / 1000} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const freshnessToTbs = {
  pd: "qdr:d",
  pw: "qdr:w",
  pm: "qdr:m",
  py: "qdr:y",
} as const;

export async function searchFirecrawl(
  apiKey: string,
  args: {
    query: string;
    count: number;
    freshness?: keyof typeof freshnessToTbs;
    country?: string;
    location?: string;
  },
  fetchImpl?: FetchLike,
): Promise<FirecrawlSearchResult[]> {
  const data = await firecrawlPost<{ web?: FirecrawlSearchResult[] }>(
    "/search",
    apiKey,
    {
      query: args.query,
      limit: args.count,
      ...(args.freshness ? { tbs: freshnessToTbs[args.freshness] } : {}),
      ...(args.country ? { country: args.country } : {}),
      ...(args.location ? { location: args.location } : {}),
    },
    fetchImpl,
  );
  return data.web ?? [];
}

export async function scrapeFirecrawl(
  apiKey: string,
  url: string,
  fetchImpl?: FetchLike,
): Promise<FirecrawlScrapeResult> {
  return firecrawlPost<FirecrawlScrapeResult>(
    "/scrape",
    apiKey,
    {
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      removeBase64Images: true,
      blockAds: true,
      timeout: 60_000,
    },
    fetchImpl,
  );
}
