import { loadConfig } from "./infra/config/load-config.js";

const loaded = loadConfig();

export const config = loaded.config;
export const repoOwner = loaded.repo.owner;
export const repoName = loaded.repo.name;

export type { AppConfig } from "./infra/config/types.js";
