import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { Octokit } from "@octokit/rest";
import { getBotProcess, withPm2, PM2_NAME, PROJECT_ROOT } from "../pm2-helper.js";
import { loadTokens } from "../../providers/minimax-oauth.js";
import { loadTokens as loadOpenaiTokens } from "../../providers/openai-oauth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "../../..", ".env");

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const WARN = "\x1b[33m!\x1b[0m";

interface Check {
  name: string;
  run: () => Promise<"pass" | "fail" | "warn">;
}

export function registerDoctorCommand(program: Command) {
  program
    .command("doctor")
    .description("Check configuration, connections, and health")
    .option("--fix", "Attempt to automatically fix issues (typecheck, restart bot)")
    .action(async (opts: { fix?: boolean }) => {
      console.log("Running diagnostics...\n");

      // Load env
      let env: Record<string, string> = {};
      if (existsSync(ENV_PATH)) {
        const lines = readFileSync(ENV_PATH, "utf-8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq !== -1) {
            env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
          }
        }
      }

      const checks: Check[] = [
        {
          name: ".env file exists",
          run: async () => {
            if (existsSync(ENV_PATH)) return "pass";
            console.log('    Run "chris setup" to create .env');
            return "fail";
          },
        },
        {
          name: "Claude OAuth token (optional)",
          run: async () => {
            if (env.CLAUDE_CODE_OAUTH_TOKEN) return "pass";
            console.log('    Not set — Claude provider unavailable. Set CLAUDE_CODE_OAUTH_TOKEN to enable.');
            return "warn";
          },
        },
        {
          name: "TELEGRAM_BOT_TOKEN is set",
          run: async () => {
            if (env.TELEGRAM_BOT_TOKEN) return "pass";
            console.log("    Create a bot with @BotFather on Telegram");
            return "fail";
          },
        },
        {
          name: "TELEGRAM_ALLOWED_USER_ID is set",
          run: async () => {
            if (env.TELEGRAM_ALLOWED_USER_ID) return "pass";
            console.log("    Message @userinfobot on Telegram to get your ID");
            return "fail";
          },
        },
        {
          name: "GITHUB_TOKEN is set",
          run: async () => {
            if (env.GITHUB_TOKEN) return "pass";
            console.log("    Create a fine-grained PAT at github.com/settings/tokens");
            return "fail";
          },
        },
        {
          name: "GITHUB_MEMORY_REPO is set",
          run: async () => {
            if (env.GITHUB_MEMORY_REPO) return "pass";
            console.log("    Set to owner/repo format (e.g. your-username/chris-assistant-memory)");
            return "fail";
          },
        },
        {
          name: "GitHub token can access memory repo",
          run: async () => {
            if (!env.GITHUB_TOKEN || !env.GITHUB_MEMORY_REPO) return "fail";
            try {
              const octokit = new Octokit({ auth: env.GITHUB_TOKEN });
              const [owner, repo] = env.GITHUB_MEMORY_REPO.split("/");
              await octokit.repos.get({ owner, repo });
              return "pass";
            } catch (err: any) {
              if (err.status === 401) {
                console.log("    Token is invalid or expired");
              } else if (err.status === 404) {
                console.log("    Repo not found — check GITHUB_MEMORY_REPO and token permissions");
              } else {
                console.log("    Error: %s", err.message);
              }
              return "fail";
            }
          },
        },
        {
          name: "Memory repo has identity files",
          run: async () => {
            if (!env.GITHUB_TOKEN || !env.GITHUB_MEMORY_REPO) return "fail";
            try {
              const octokit = new Octokit({ auth: env.GITHUB_TOKEN });
              const [owner, repo] = env.GITHUB_MEMORY_REPO.split("/");
              await octokit.repos.getContent({ owner, repo, path: "identity/SOUL.md" });
              return "pass";
            } catch {
              console.log("    identity/SOUL.md not found — push seed memory files first");
              return "fail";
            }
          },
        },
        {
          name: "Telegram bot token is valid",
          run: async () => {
            if (!env.TELEGRAM_BOT_TOKEN) return "fail";
            try {
              const res = await fetch(
                `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`,
              );
              const data = await res.json();
              if (data.ok) {
                console.log("    Bot: @%s", data.result.username);
                return "pass";
              }
              console.log("    Token rejected by Telegram API");
              return "fail";
            } catch (err: any) {
              console.log("    Could not reach Telegram API: %s", err.message);
              return "fail";
            }
          },
        },
        {
          name: "OpenAI OAuth tokens",
          run: async () => {
            const tokens = loadOpenaiTokens();
            if (!tokens) {
              console.log('    Not set up — run "chris openai login"');
              return "warn";
            }
            const now = Date.now();
            if (now >= tokens.expires) {
              console.log("    Token expired (will auto-refresh on next API call)");
              return "pass";
            }
            const remaining = tokens.expires - now;
            const minutes = Math.floor(remaining / 60000);
            console.log("    Valid (%dm remaining, auto-refreshes)", minutes);
            return "pass";
          },
        },
        {
          name: "MiniMax OAuth tokens",
          run: async () => {
            const tokens = loadTokens();
            if (!tokens) {
              console.log('    Not set up — run "chris minimax login"');
              return "warn";
            }
            const now = Date.now();
            if (now >= tokens.expires) {
              console.log('    Token expired — run "chris minimax login"');
              return "warn";
            }
            const remaining = tokens.expires - now;
            const hours = Math.floor(remaining / 3600000);
            console.log("    Valid (%dh remaining)", hours);
            return "pass";
          },
        },
        {
          name: "Brave Search API key",
          run: async () => {
            if (!env.BRAVE_SEARCH_API_KEY) {
              console.log('    Not set — web search tool will be disabled');
              return "warn";
            }
            // Quick validation — try a search
            try {
              const res = await fetch("https://api.search.brave.com/res/v1/web/search?q=test&count=1", {
                headers: {
                  "Accept": "application/json",
                  "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY,
                },
              });
              if (res.ok) return "pass";
              console.log("    API returned %d — check your key", res.status);
              return "fail";
            } catch (err: any) {
              console.log("    Could not reach Brave Search API: %s", err.message);
              return "fail";
            }
          },
        },
        {
          name: "Bot process",
          run: async () => {
            const proc = await getBotProcess();
            if (!proc) {
              console.log('    Not running — use "chris start"');
              return "warn";
            }
            if (proc.status === "online") {
              console.log("    Running (pid %d)", proc.pid);
              return "pass";
            }
            console.log("    Status: %s (restarts: %d)", proc.status, proc.restarts ?? 0);
            if (proc.status === "errored") {
              // Show recent error log excerpt
              try {
                const errLogPath = resolve(
                  process.env.HOME || "~",
                  ".pm2/logs/chris-assistant-error.log",
                );
                if (existsSync(errLogPath)) {
                  const errLog = readFileSync(errLogPath, "utf-8");
                  const lines = errLog.trim().split("\n");
                  // Find the last meaningful error line (skip blank and pm2 prefix noise)
                  const errorLines = lines
                    .slice(-20)
                    .map((l) => l.replace(/^\d+\|chris-as \| /, "").trim())
                    .filter((l) => l.length > 0);
                  // Look for the key error message
                  const errorSummary = errorLines.find(
                    (l) => l.includes("ERROR:") || l.includes("Error") || l.includes("error"),
                  );
                  if (errorSummary) {
                    console.log("    Last error: %s", errorSummary.slice(0, 120));
                  }
                }
              } catch {
                // Ignore — best effort
              }
            }
            return proc.status === "errored" ? "fail" : "warn";
          },
        },
      ];

      let passes = 0;
      let fails = 0;
      let warns = 0;

      for (const check of checks) {
        const result = await check.run();
        const icon = result === "pass" ? PASS : result === "fail" ? FAIL : WARN;
        console.log("  %s %s", icon, check.name);
        if (result === "pass") passes++;
        else if (result === "fail") fails++;
        else warns++;
      }

      console.log("\n%d passed, %d warnings, %d failed", passes, warns, fails);

      // --fix: attempt to diagnose and repair
      if (opts.fix) {
        console.log("\n--- Auto-fix ---\n");

        const proc = await getBotProcess();
        const botErrored = proc && (proc.status === "errored" || proc.status === "stopped");
        const botMissing = !proc;

        if (!botErrored && !botMissing && proc?.status === "online") {
          console.log("  %s Bot is already running — nothing to fix.", PASS);
        } else {
          // Step 1: Typecheck
          console.log("  Running typecheck...");
          try {
            execFileSync("npx", ["tsc", "--noEmit"], {
              cwd: PROJECT_ROOT,
              timeout: 30_000,
              stdio: "pipe",
            });
            console.log("  %s Typecheck passed", PASS);
          } catch (err: any) {
            const output = (err.stdout?.toString() || "") + (err.stderr?.toString() || "");
            console.log("  %s Typecheck failed:\n", FAIL);
            // Show the actual errors (compact)
            const errorLines = output
              .split("\n")
              .filter((l: string) => l.includes("error TS") || l.includes("ERROR:"))
              .slice(0, 10);
            for (const line of errorLines) {
              console.log("    %s", line.trim());
            }
            if (errorLines.length === 0) {
              // Show raw output if no TS errors found
              console.log("    %s", output.trim().split("\n").slice(0, 5).join("\n    "));
            }
            console.log("\n  Fix the errors above, then run 'chris doctor --fix' again.");
            return;
          }

          // Step 2: Check error logs for common issues
          try {
            const errLogPath = resolve(
              process.env.HOME || "~",
              ".pm2/logs/chris-assistant-error.log",
            );
            if (existsSync(errLogPath)) {
              const errLog = readFileSync(errLogPath, "utf-8");
              const lines = errLog.trim().split("\n").slice(-30);
              const cleaned = lines.map((l) =>
                l.replace(/^\d+\|chris-as \| /, "").trim(),
              );

              // Check for common fixable patterns
              const hasTransformError = cleaned.some((l) => l.includes("TransformError"));
              const hasSyntaxError = cleaned.some((l) => l.includes("SyntaxError") || l.includes("Syntax error"));
              const hasModuleNotFound = cleaned.some((l) => l.includes("Cannot find module") || l.includes("MODULE_NOT_FOUND"));

              if (hasModuleNotFound) {
                console.log("  Missing module detected — running npm install...");
                try {
                  execFileSync("npm", ["install"], {
                    cwd: PROJECT_ROOT,
                    timeout: 60_000,
                    stdio: "pipe",
                  });
                  console.log("  %s npm install completed", PASS);
                } catch {
                  console.log("  %s npm install failed — check manually", FAIL);
                  return;
                }
              }

              if (hasTransformError || hasSyntaxError) {
                console.log("  Detected syntax/transform error in error logs.");
                console.log("  Typecheck passed — this may have been fixed already.");
              }
            }
          } catch {
            // Ignore — best effort
          }

          // Step 3: Restart the bot
          console.log("  Restarting bot...");
          try {
            if (botMissing) {
              console.log('  Bot not in pm2 — use "chris start" instead.');
              return;
            }
            await withPm2(async (pm2Instance) => {
              return new Promise<void>((resolve, reject) => {
                pm2Instance.restart(PM2_NAME, (err) => {
                  if (err) return reject(err);
                  resolve();
                });
              });
            });

            // Wait a moment and check status
            await new Promise((r) => setTimeout(r, 3000));
            const newProc = await getBotProcess();
            if (newProc?.status === "online") {
              console.log("  %s Bot restarted successfully (pid %d)", PASS, newProc.pid);
            } else {
              console.log("  %s Bot restarted but status is: %s", FAIL, newProc?.status ?? "unknown");
              console.log('    Check logs with "chris logs" for details.');
            }
          } catch (err: any) {
            console.log("  %s Failed to restart: %s", FAIL, err.message);
          }
        }
      } else if (fails > 0) {
        console.log('\nFix the failures above, then run "chris doctor" again.');
        // Hint about --fix if bot is the issue
        const proc = await getBotProcess();
        if (proc && (proc.status === "errored" || proc.status === "stopped")) {
          console.log('Or try "chris doctor --fix" to auto-diagnose and restart.');
        }
      } else if (warns > 0) {
        console.log("\nLooking good — just some minor warnings above.");
      } else {
        console.log("\nAll checks passed. You're good to go.");
      }
    });
}
