import { startTelegram, stopTelegram } from "../channels/telegram/index.js";
import { createPostTelegramRegistry, createPreTelegramRegistry } from "./service-definitions.js";

let started = false;
let runtimeStarted = false;

const preTelegramRegistry = createPreTelegramRegistry();
const postTelegramRegistry = createPostTelegramRegistry();

export async function startApp(): Promise<void> {
  if (started) return;
  started = true;

  console.log("[chris-assistant] Starting up...");

  await preTelegramRegistry.startAll();

  startTelegram((botInfo) => {
    console.log("[chris-assistant] Bot is live as @%s", botInfo.username);
    console.log("[chris-assistant] Waiting for messages...");

    postTelegramRegistry.startAll()
      .then(() => {
        runtimeStarted = true;
      })
      .catch((err: any) => {
        console.error("[chris-assistant] Failed to start runtime services:", err.message);
      });
  });
}

export async function stopApp(): Promise<void> {
  if (!started) return;
  started = false;

  console.log("[chris-assistant] Shutting down...");

  if (runtimeStarted) {
    await postTelegramRegistry.stopAll();
    runtimeStarted = false;
  }

  await stopTelegram();
  await preTelegramRegistry.stopAll();
}
