import { loadRuntimeConfig } from "./infra/config/load-config.js";

const loaded = loadRuntimeConfig();

export const config = loaded.config;
export const repoOwner = loaded.repo.owner;
export const repoName = loaded.repo.name;

export type { AppConfig } from "./infra/config/types.js";
