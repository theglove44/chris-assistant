import type { ReasoningEffort } from "../../providers/model-routing.js";

export interface AppConfig {
  model: string;
  imageModel: string;
  reasoningEffort: ReasoningEffort | null;
  telegram: {
    botToken: string;
    allowedUserId: number;
    allowBotMessages: boolean;
    transport: "polling" | "webhook";
    webhookUrl: string | null;
    webhookSecret: string | null;
    webhookPort: number;
  };
  github: {
    token: string;
    memoryRepo: string;
  };
  discord: {
    botToken: string | null;
    guildId: string | null;
  };
  braveSearchApiKey: string | null;
  deepseek: {
    apiKey: string | null;
    thinking: "enabled" | "disabled";
  };
  maxToolTurns: number;
  dashboard: {
    port: number;
    token: string | null;
    docsUrl: string | null;
  };
  webhook: {
    secret: string | null;
    port: number;
  };
  symphony: {
    statusUrl: string;
  };
  notice: {
    enabled: boolean;
    intervalMs: number;
    quietStartHour: number;
    quietEndHour: number;
    minGapMs: number;
    dailyLimit: number;
    journalGapDays: number;
  };
  octopus: {
    apiKey: string | null;
    accountNumber: string | null;
  };
}
