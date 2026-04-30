// Callback data is capped at 64 bytes by Telegram. Keep the namespace short
// and only encode action verbs — never user-controlled text.
const NAMESPACE = "ca";
const SEP = ":";

export type CallbackAction = "purge:yes" | "purge:no" | "restart:yes" | "restart:no";

const ACTIONS: ReadonlySet<string> = new Set([
  "purge:yes",
  "purge:no",
  "restart:yes",
  "restart:no",
]);

export function encodeCallback(action: CallbackAction): string {
  return NAMESPACE + SEP + action;
}

// Returns null for any payload that did not originate from this module — the
// allowlist is the auth boundary for the callback router, so unknown actions
// are dropped without dispatch.
export function parseCallbackData(data: string | undefined): CallbackAction | null {
  if (!data) return null;
  const prefix = NAMESPACE + SEP;
  if (!data.startsWith(prefix)) return null;
  const action = data.slice(prefix.length);
  return ACTIONS.has(action) ? (action as CallbackAction) : null;
}
