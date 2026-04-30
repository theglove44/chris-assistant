import type { Bot, Context } from "grammy";
import { executeSkill } from "../../skills/executor.js";
import { loadSkillIndex } from "../../skills/loader.js";
import {
  buildSkillCommandPlan,
  type SkillCommandPlan,
  type TelegramCommandEntry,
} from "./skill-commands.js";

let activeSkillRoutes: Map<string, string> = new Map();

export function setActiveSkillRoutes(routes: Map<string, string>): void {
  activeSkillRoutes = routes;
}

export function getActiveSkillRoutes(): Map<string, string> {
  return activeSkillRoutes;
}

/**
 * Register a fallback handler for any `/<skill-command>` message that matches
 * a currently-registered skill. Static commands have already been bound by
 * `registerTelegramCommands` so they short-circuit before this runs.
 */
export function registerSkillCommandRouter(bot: Bot<Context>): void {
  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message.text;
    if (!text.startsWith("/")) {
      await next();
      return;
    }

    // Strip leading `/`, optional `@botname` suffix, ignore trailing arg text.
    const space = text.indexOf(" ");
    const head = space === -1 ? text.slice(1) : text.slice(1, space);
    const command = head.split("@")[0];
    const skillId = activeSkillRoutes.get(command);
    if (!skillId) {
      await next();
      return;
    }

    try {
      const result = await executeSkill(skillId);
      await ctx.reply(result || "(skill produced no output)");
    } catch (err: any) {
      console.error("[telegram] skill command /%s failed:", command, err?.message ?? err);
      await ctx.reply(`Skill "/${command}" failed: ${err?.message ?? "unknown error"}`);
    }
  });
}

export async function loadSkillCommandPlan(
  staticMenu: ReadonlyArray<TelegramCommandEntry>,
): Promise<SkillCommandPlan> {
  const skills = await loadSkillIndex();
  return buildSkillCommandPlan(staticMenu, skills);
}
