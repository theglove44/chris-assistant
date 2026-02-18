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

      // Claude token
      console.log("--- Claude ---");
      console.log('Run "claude setup-token" in another terminal to get your OAuth token.');
      const claudeToken = await ask(rl, "CLAUDE_CODE_OAUTH_TOKEN: ");

      // Telegram
      console.log("\n--- Telegram ---");
      console.log("Create a bot with @BotFather. Get your user ID from @userinfobot.");
      const telegramToken = await ask(rl, "TELEGRAM_BOT_TOKEN: ");
      const telegramUserId = await ask(rl, "TELEGRAM_ALLOWED_USER_ID: ");

      // GitHub
      console.log("\n--- GitHub ---");
      console.log("Create a fine-grained PAT with Contents read/write on your memory repo.");
      const githubToken = await ask(rl, "GITHUB_TOKEN: ");
      const githubRepo = await ask(rl, "GITHUB_MEMORY_REPO (e.g. theglove44/chris-assistant-memory): ");

      rl.close();

      // Build .env
      const envLines: string[] = [];
      const addLine = (key: string, value: string, comment?: string) => {
        if (comment) envLines.push(`# ${comment}`);
        envLines.push(`${key}=${value}`);
      };

      addLine("CLAUDE_CODE_OAUTH_TOKEN", claudeToken || "your_oauth_token_here", "Claude authentication");
      envLines.push("");
      addLine("TELEGRAM_BOT_TOKEN", telegramToken || "your_telegram_bot_token_here", "Telegram bot");
      addLine("TELEGRAM_ALLOWED_USER_ID", telegramUserId || "your_numeric_user_id_here");
      envLines.push("");
      addLine("GITHUB_TOKEN", githubToken || "your_github_pat_here", "GitHub memory repo");
      addLine("GITHUB_MEMORY_REPO", githubRepo || "theglove44/chris-assistant-memory");
      envLines.push("");

      writeFileSync(ENV_PATH, envLines.join("\n") + "\n");

      console.log("\n.env written to %s", ENV_PATH);
      console.log('\nRun "chris doctor" to verify everything is connected.');
      console.log('Then "chris start" to launch the bot.');
    });
}
