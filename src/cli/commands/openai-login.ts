import { Command } from "commander";
import { randomBytes } from "crypto";
import { exec } from "child_process";
import {
  generatePkce,
  buildAuthorizationUrl,
  waitForAuthCallback,
  exchangeForTokens,
  saveTokens,
  loadTokens,
} from "../../providers/openai-oauth.js";

export function registerOpenaiCommand(program: Command) {
  const openai = program
    .command("openai")
    .description("OpenAI provider management");

  openai
    .command("login")
    .description("Authenticate with OpenAI via OAuth (opens browser)")
    .action(async () => {
      console.log("Starting OpenAI OAuth login...\n");

      // Generate PKCE verifier + challenge
      const { verifier, challenge } = generatePkce();
      const state = randomBytes(16).toString("hex");

      // Build authorization URL
      const authUrl = buildAuthorizationUrl(challenge, state);

      // Start local callback server
      const { promise: codePromise, server } = waitForAuthCallback(state);

      // Open browser
      console.log("Opening browser for authentication...\n");
      const openCommand =
        process.platform === "darwin" ? "open" :
        process.platform === "win32" ? "start" : "xdg-open";
      exec(`${openCommand} "${authUrl}"`, (err) => {
        if (err) {
          console.log("Could not open browser automatically.");
          console.log("Please open this URL manually:\n");
          console.log("  %s\n", authUrl);
        }
      });

      console.log("Waiting for authentication in browser...");

      try {
        // Wait for the callback with the auth code
        const authCode = await codePromise;
        server.close();

        console.log("\nReceived authorization code. Exchanging for tokens...");

        // Exchange auth code for tokens
        const tokens = await exchangeForTokens(authCode, verifier);
        saveTokens(tokens);

        const expiresDate = new Date(tokens.expires);
        console.log("\nAuthenticated successfully.");
        if (tokens.accountId) {
          console.log("Account ID: %s", tokens.accountId);
        }
        console.log("Token expires: %s (auto-refreshes)", expiresDate.toLocaleString());
        console.log(
          '\nYou can now use OpenAI models. Run "chris model set gpt5" to switch.',
        );
      } catch (err: any) {
        server.close();
        console.error("\nLogin failed: %s", err.message);
        process.exit(1);
      }
    });

  openai
    .command("status")
    .description("Check OpenAI OAuth token status")
    .action(() => {
      const tokens = loadTokens();
      if (!tokens) {
        console.log('Not authenticated. Run "chris openai login" to set up.');
        return;
      }

      const now = Date.now();
      const remainingMs = tokens.expires - now;

      if (tokens.accountId) {
        console.log("Account ID: %s", tokens.accountId);
      }

      if (remainingMs <= 0) {
        const expiresDate = new Date(tokens.expires);
        console.log("Token expired at %s", expiresDate.toLocaleString());
        console.log("Token will auto-refresh on next API call, or run \"chris openai login\" to re-authenticate.");
      } else {
        const expiresDate = new Date(tokens.expires);
        const minutes = Math.floor(remainingMs / 60000);
        console.log("Authenticated.");
        console.log("Token expires: %s (%dm remaining, auto-refreshes)", expiresDate.toLocaleString(), minutes);
      }
    });
}
