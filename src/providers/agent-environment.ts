const BASE_AGENT_ENV_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
] as const;

/** Build the smallest practical CLI environment without forwarding application secrets. */
export function buildAgentEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  additionalKeys: readonly string[] = [],
): Record<string, string> {
  const allowed = new Set<string>([...BASE_AGENT_ENV_KEYS, ...additionalKeys]);
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => allowed.has(entry[0]) && entry[1] !== undefined),
  );
}
