import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
const ENV_PATH = resolve(PROJECT_ROOT, ".env");
const ENV_EXAMPLE_PATH = resolve(PROJECT_ROOT, ".env.example");

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export function registerSetupCommand(program: Command) {
  program
    .command("setup")
    .description("Interactive first-time setup")
    .action(async () => {
      console.log("Chris Assistant — Setup\n");

      if (existsSync(ENV_PATH)) {
        console.log("A .env file already exists at %s", ENV_PATH);
        console.log('Use "chris config" to view/edit, or delete .env to start fresh.\n');

        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await ask(rl, "Overwrite existing .env? (y/N) ");
        rl.close();

        if (answer.toLowerCase() !== "y") {
          console.log("Aborted.");
          return;
        }
      }

      // Start from the example template
      if (existsSync(ENV_EXAMPLE_PATH)) {
        copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
      }

      const rl = createInterface({ input: process.stdin, output: process.stdout });

      console.log("I'll walk you through each value. Press Enter to skip any.\n");

      // Telegram
      console.log("--- Telegram ---");
      console.log("Create a bot with @BotFather. Get your user ID from @userinfobot.");
      const telegramToken = await ask(rl, "TELEGRAM_BOT_TOKEN: ");
      const telegramUserId = await ask(rl, "TELEGRAM_ALLOWED_USER_ID: ");

      // GitHub
      console.log("\n--- GitHub ---");
      console.log("Create a fine-grained PAT with Contents read/write on your memory repo.");
      const githubToken = await ask(rl, "GITHUB_TOKEN: ");
      const githubRepo = await ask(rl, "GITHUB_MEMORY_REPO (e.g. your-username/chris-assistant-memory): ");

      // Brave Search (optional)
      console.log("\n--- Web Search (optional) ---");
      console.log("Get a free API key at brave.com/search/api for the web search tool.");
      const braveKey = await ask(rl, "BRAVE_SEARCH_API_KEY (press Enter to skip): ");

      rl.close();

      // Build .env
      const envLines: string[] = [];
      const addLine = (key: string, value: string, comment?: string) => {
        if (comment) envLines.push(`# ${comment}`);
        envLines.push(`${key}=${value}`);
      };

      addLine("TELEGRAM_BOT_TOKEN", telegramToken || "your_telegram_bot_token_here", "Telegram bot");
      addLine("TELEGRAM_ALLOWED_USER_ID", telegramUserId || "your_numeric_user_id_here");
      envLines.push("");
      addLine("GITHUB_TOKEN", githubToken || "your_github_pat_here", "GitHub memory repo");
      addLine("GITHUB_MEMORY_REPO", githubRepo || "");
      envLines.push("");
      if (braveKey) {
        addLine("BRAVE_SEARCH_API_KEY", braveKey, "Web search (Brave Search API)");
        envLines.push("");
      }

      writeFileSync(ENV_PATH, envLines.join("\n") + "\n");

      console.log("\n.env written to %s", ENV_PATH);
      console.log('\nNext steps:');
      console.log('  chris openai login    # Authenticate with OpenAI (default provider)');
      console.log('  chris doctor          # Verify everything is connected');
      console.log('  chris start           # Launch the bot');
    });
}
