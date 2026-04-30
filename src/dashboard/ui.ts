import { readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "../config.js";

/**
 * Dashboard UI loader.
 *
 * The HTML lives in `ui.html` (real .html file with syntax highlighting), and
 * the CSS lives in `ui.css`. They are read from disk at module load time and
 * stitched together here. The HTML still contains its original inline `<script>`
 * block — extracting that to a real .js file is tracked as a separate follow-up.
 *
 * Templating placeholders the HTML uses:
 *   __DASHBOARD_CSS__         — replaced with the contents of ui.css
 *   __DASHBOARD_DOCS_LINK__   — replaced with the docs-link <a> tag (or "")
 */

const TEMPLATE_DIR = import.meta.dirname;
const HTML_TEMPLATE = readFileSync(join(TEMPLATE_DIR, "ui.html"), "utf8");
const CSS_TEMPLATE = readFileSync(join(TEMPLATE_DIR, "ui.css"), "utf8");

const CSS_PLACEHOLDER = "__DASHBOARD_CSS__";
const DOCS_LINK_PLACEHOLDER = "__DASHBOARD_DOCS_LINK__";

function sanitizeDocsUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href.replace(/"/g, "&quot;");
  } catch {
    return null;
  }
}

const SAFE_DOCS_URL = sanitizeDocsUrl(config.dashboard.docsUrl);

function renderDocsLink(url: string | null): string {
  if (!url) return "";
  return `    <a class="docs-link" href="${url}" target="_blank" rel="noopener noreferrer">\u{1F4DA} Knowledge Base</a>\n`;
}

// Pre-compute the rendered HTML once at module load — neither the CSS nor the
// docs URL change at runtime, so there is no benefit to re-rendering per call.
const RENDERED_HTML = HTML_TEMPLATE.replace(CSS_PLACEHOLDER, () => CSS_TEMPLATE).replace(
  DOCS_LINK_PLACEHOLDER,
  () => renderDocsLink(SAFE_DOCS_URL),
);

export function getDashboardHtml(): string {
  return RENDERED_HTML;
}
