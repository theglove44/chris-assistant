/**
 * Checks for regex patterns that crash esbuild/tsx.
 *
 * esbuild misparses </ inside regex literals as an HTML closing tag,
 * causing a TransformError at runtime. This catches it at typecheck time.
 *
 * Fix: use new RegExp("<" + "/tag>", "g") instead of a regex literal.
 */

import { readFileSync } from "fs";
import { execSync } from "child_process";

// Find all .ts files in src/
const files = execSync('find src/ -name "*.ts" -type f', {
  encoding: "utf8",
}).trim().split("\n").filter(Boolean);

const problems = [];

for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    // Skip comment lines
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    // Check for <\/ in actual code (regex literals)
    if (/\/<[^>]*\\\//.test(line)) {
      problems.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  }
}

if (problems.length > 0) {
  console.error(
    "\x1b[31mERROR: Found <\\/ in regex literals \u2014 esbuild will crash on these.\x1b[0m\n" +
    'Use string concatenation instead: new RegExp("<" + "/tag>", "g")\n\n' +
    problems.join("\n")
  );
  process.exit(1);
}
