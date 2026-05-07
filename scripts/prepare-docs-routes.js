import { copyFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { basename, dirname, join, relative } from "path";

const distDir = join(process.cwd(), "docs", ".vitepress", "dist");

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

let created = 0;

for (const filePath of walk(distDir)) {
  if (!filePath.endsWith(".html")) continue;
  if (basename(filePath) === "index.html" || basename(filePath) === "404.html") continue;

  const routePath = filePath.slice(0, -".html".length);
  const aliasPath = join(routePath, "index.html");

  if (filePath === aliasPath) continue;
  try {
    if (statSync(routePath).isFile()) continue;
  } catch {
    // No exact file at the extensionless route, so create a directory alias.
  }

  mkdirSync(routePath, { recursive: true });
  copyFileSync(filePath, aliasPath);
  created++;
}

console.log(`[docs] Prepared ${created} extensionless route aliases in ${relative(process.cwd(), distDir)}`);
