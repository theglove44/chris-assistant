#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mode = process.argv[2] ?? "baseline";

if (mode === "--help" || mode === "-h") {
  console.log("Usage: node scripts/check-provider-integration.mjs [baseline|final]");
  console.log("  baseline  Read-only checks that are valid before the provider work lands.");
  console.log("  final     Target four-provider and no-Claude acceptance checks.");
  process.exit(0);
}

if (mode !== "baseline" && mode !== "final") {
  console.error(`Unknown mode: ${mode}`);
  process.exit(2);
}

const failures = [];
const passes = [];

function check(label, condition, detail) {
  if (condition) {
    passes.push(label);
    return;
  }
  failures.push(detail ? `${label}: ${detail}` : label);
}

function read(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function searchableFiles(paths) {
  const textExtensions = new Set([".json", ".md", ".mjs", ".ts"]);
  const visibleFiles = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repoRoot, encoding: "utf8" },
  ).split("\0").filter(Boolean);
  return visibleFiles.filter((path) =>
    paths.some((root) => path === root || path.startsWith(`${root}/`))
    && (textExtensions.has(extname(path)) || path === ".env.example"),
  );
}

function findMatches(paths, pattern) {
  const matches = [];
  for (const path of searchableFiles(paths)) {
    const lines = read(path).split("\n");
    lines.forEach((line, index) => {
      if (pattern.test(line)) matches.push(`${path}:${index + 1}`);
      pattern.lastIndex = 0;
    });
  }
  return matches;
}

const packageJson = JSON.parse(read("package.json"));
for (const script of ["typecheck", "test", "build", "docs:build"]) {
  check(`package script ${script}`, typeof packageJson.scripts?.[script] === "string");
}

for (const path of [
  "src/agent/chat-service.ts",
  "src/providers/index.ts",
  "src/providers/model-routing.ts",
  "src/providers/types.ts",
]) {
  check(`provider seam ${path}`, existsSync(join(repoRoot, path)));
}

const providerFacade = read("src/providers/index.ts");
check(
  "provider-neutral clear facade",
  providerFacade.includes("clearActiveProviderSession"),
  "channels should not clear provider-specific state directly",
);
check(
  "provider-neutral abort facade",
  providerFacade.includes("abortActiveProviderQuery"),
  "channels should not abort provider-specific work directly",
);
check(
  "provider-neutral session facade",
  providerFacade.includes("getActiveProviderSessionInfo"),
  "session display needs a provider-neutral entry point",
);

if (mode === "final") {
  check(
    "legacy CLAUDE.md guidance removed",
    !existsSync(join(repoRoot, "CLAUDE.md")),
    "move still-valid project guidance into AGENTS.md before deleting CLAUDE.md",
  );

  const activePaths = [
    "src",
    "tests",
    "scripts",
    "docs",
    "README.md",
    "AGENTS.md",
    ".env.example",
    "package.json",
    "package-lock.json",
  ];
  const claudeMatches = findMatches(activePaths, /anthropic|claude/i)
    .filter((match) => ![
      "scripts/check-provider-integration.mjs:",
      "docs/development/provider-integration-acceptance.md:",
    ].some((allowedPrefix) => match.startsWith(allowedPrefix)));
  check(
    "no active Claude or Anthropic references",
    claudeMatches.length === 0,
    claudeMatches.slice(0, 20).join(", ") + (claudeMatches.length > 20 ? " ..." : ""),
  );

  const providerSources = searchableFiles(["src/providers", "src/agent", "src/infra/config"])
    .map((path) => read(path))
    .join("\n");
  const expectedMarkers = [
    ["OpenAI Responses", /gpt-5\.6-(?:sol|terra|luna)/i],
    ["Codex Agent", /codex-agent/i],
    ["Grok Agent", /grok(?:-agent)?/i],
    ["DeepSeek", /deepseek-v4-(?:flash|pro)/i],
  ];
  for (const [label, pattern] of expectedMarkers) {
    check(`provider marker ${label}`, pattern.test(providerSources));
  }

  const configAndDisplay = searchableFiles([
    "src/infra/config",
    "src/cli/commands/model.ts",
    "src/channels/telegram/commands.ts",
    "src/dashboard",
  ]).map((path) => read(path)).join("\n");
  check("reasoning effort configuration", /AI_REASONING_EFFORT/.test(configAndDisplay));
  check("requested effort display", /requested.{0,20}effort/is.test(configAndDisplay));
  check("effective effort display", /effective.{0,20}effort/is.test(configAndDisplay));

  const routing = read("src/providers/model-routing.ts");
  check(
    "unknown models fail explicitly",
    /Unknown model/.test(routing) && !/return\s+["']claude["']/.test(routing),
  );
}

for (const label of passes) console.log(`PASS ${label}`);
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`\n${passes.length} passed, ${failures.length} failed (${mode})`);

if (failures.length > 0) process.exit(1);
