import { existsSync, readFileSync } from "fs";
import { join } from "path";

const distDir = join(process.cwd(), "docs", ".vitepress", "dist");

const routes = [
  { path: "getting-started/overview", title: "Overview" },
  { path: "operating-manual", title: "Operating Manual" },
  { path: "architecture/providers", title: "Providers" },
  { path: "tools/memory", title: "Memory" },
  { path: "cli/reference", title: "CLI Command Reference" },
];

function stripTags(value) {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function readRoute(routePath) {
  const filePath = join(distDir, routePath, "index.html");
  if (!existsSync(filePath)) {
    throw new Error(`Missing extensionless route artifact: ${routePath}/index.html`);
  }
  return readFileSync(filePath, "utf-8");
}

for (const route of routes) {
  const html = readRoute(route.path);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const h1 = h1Match ? stripTags(h1Match[1]) : "";

  if (!h1.includes(route.title)) {
    throw new Error(`Route ${route.path} rendered "${h1 || "(no h1)"}", expected "${route.title}"`);
  }

  if (route.path !== "index" && h1.includes("Personal AI Assistant")) {
    throw new Error(`Route ${route.path} appears to contain the home page fallback`);
  }
}

console.log(`[docs] Smoke checked ${routes.length} extensionless deep routes`);
