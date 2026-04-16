export interface AppConfig {
  model: string;
  imageModel: string;
  telegram: {
    botToken: string;
    allowedUserId: number;
    allowBotMessages: boolean;
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
  octopus: {
    apiKey: string | null;
    accountNumber: string | null;
  };
}
