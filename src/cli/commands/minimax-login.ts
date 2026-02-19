import { Command } from "commander";
import {
  generatePKCE,
  requestDeviceCode,
  pollForToken,
  saveTokens,
  loadTokens,
} from "../../providers/minimax-oauth.js";

export function registerMinimaxCommand(program: Command) {
  const minimax = program
    .command("minimax")
    .description("MiniMax provider management");

  minimax
    .command("login")
    .description("Authenticate with MiniMax via OAuth device flow")
    .action(async () => {
      console.log("Starting MiniMax OAuth login...\n");

      // 1. Generate PKCE
      const { verifier, challenge, state } = generatePKCE();

      // 2. Request device code
      let deviceCode;
      try {
        deviceCode = await requestDeviceCode(challenge, state);
      } catch (err: any) {
        console.error("Failed to start OAuth flow: %s", err.message);
        process.exit(1);
      }

      // 3. Show instructions
      console.log("Open this URL in your browser:\n");
      console.log("  %s\n", deviceCode.verification_uri);
      console.log("Enter this code when prompted:\n");
      console.log("  %s\n", deviceCode.user_code);
      console.log("Waiting for approval...");

      // 4. Poll for token
      try {
        const tokens = await pollForToken(
          deviceCode.user_code,
          verifier,
          deviceCode.interval,
          deviceCode.expired_in,
        );

        // 5. Save and confirm
        saveTokens(tokens);

        const expiresDate = new Date(tokens.expires);
        console.log("\nAuthenticated successfully.");
        console.log("Token expires: %s", expiresDate.toLocaleString());
        console.log(
          '\nYou can now use MiniMax models. Run "chris model set minimax" to switch.',
        );
      } catch (err: any) {
        console.error("\nLogin failed: %s", err.message);
        process.exit(1);
      }
    });

  minimax
    .command("status")
    .description("Check MiniMax OAuth token status")
    .action(() => {
      const tokens = loadTokens();
      if (!tokens) {
        console.log('Not authenticated. Run "chris minimax login" to set up.');
        return;
      }

      const now = Date.now();
      const remainingMs = tokens.expires - now;

      if (remainingMs <= 0) {
        const expiresDate = new Date(tokens.expires);
        console.log("Token expired at %s", expiresDate.toLocaleString());
        console.log('Run "chris minimax login" to re-authenticate.');
      } else {
        const expiresDate = new Date(tokens.expires);
        const hours = Math.floor(remainingMs / 3600000);
        const minutes = Math.floor((remainingMs % 3600000) / 60000);
        console.log("Authenticated.");
        console.log("Token expires: %s (%dh %dm remaining)", expiresDate.toLocaleString(), hours, minutes);
      }
    });
}
