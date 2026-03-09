import { bot } from "./bot.js";
import { TELEGRAM_COMMAND_MENU, registerTelegramCommands } from "./commands.js";
import { registerTelegramMessageHandlers } from "./handlers.js";

registerTelegramCommands(bot);
registerTelegramMessageHandlers(bot);

export { bot };

export async function setTelegramCommandMenu(): Promise<void> {
  await bot.api.setMyCommands([...TELEGRAM_COMMAND_MENU]);
}

export function startTelegram(onStart: (botInfo: any) => void): void {
  bot.start({ onStart });
}

export function stopTelegram(): void {
  bot.stop();
}
