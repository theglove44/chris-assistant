import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Octokit } from "@octokit/rest";
import { getBotProcess } from "../pm2-helper.js";
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
    .action(async () => {
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
          name: "CLAUDE_CODE_OAUTH_TOKEN is set",
          run: async () => {
            if (env.CLAUDE_CODE_OAUTH_TOKEN) return "pass";
            console.log('    Run "claude setup-token" then add to .env');
            return "fail";
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
            console.log("    Status: %s", proc.status);
            return "warn";
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

      if (fails > 0) {
        console.log('\nFix the failures above, then run "chris doctor" again.');
      } else if (warns > 0) {
        console.log("\nLooking good — just some minor warnings above.");
      } else {
        console.log("\nAll checks passed. You're good to go.");
      }
    });
}
