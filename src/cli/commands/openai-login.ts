import { Command } from "commander";
import {
  requestDeviceCode,
  pollForAuthCode,
  exchangeForTokens,
  saveTokens,
  loadTokens,
  VERIFICATION_URL,
} from "../../providers/openai-oauth.js";

export function registerOpenaiCommand(program: Command) {
  const openai = program
    .command("openai")
    .description("OpenAI provider management");

  openai
    .command("login")
    .description("Authenticate with OpenAI via Codex OAuth device flow")
    .action(async () => {
      console.log("Starting OpenAI Codex OAuth login...\n");

      // 1. Request device code
      let deviceCode;
      try {
        deviceCode = await requestDeviceCode();
      } catch (err: any) {
        console.error("Failed to start OAuth flow: %s", err.message);
        process.exit(1);
      }

      // 2. Show instructions
      console.log("Open this URL in your browser:\n");
      console.log("  %s\n", VERIFICATION_URL);
      console.log("Enter this code when prompted:\n");
      console.log("  %s\n", deviceCode.user_code);
      console.log("Waiting for approval (up to 15 minutes)...");

      // 3. Poll for auth code
      try {
        const authResult = await pollForAuthCode(
          deviceCode.device_auth_id,
          deviceCode.user_code,
          deviceCode.interval,
        );

        // 4. Exchange for tokens
        const tokens = await exchangeForTokens(
          authResult.authorization_code,
          authResult.code_verifier,
        );

        // 5. Save and confirm
        saveTokens(tokens);

        const expiresDate = new Date(tokens.expires);
        console.log("\nAuthenticated successfully.");
        console.log("Token expires: %s (auto-refreshes)", expiresDate.toLocaleString());
        console.log(
          '\nYou can now use OpenAI models. Run "chris model set gpt4o" to switch.',
        );
      } catch (err: any) {
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
