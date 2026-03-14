const LOOP_THRESHOLD = 3;
const DEFAULT_FREQUENCY_LIMIT = 20;

let recentFingerprints: string[] = [];
const toolCallCounts = new Map<string, number>();

/**
 * Check for tool call loops and frequency abuse.
 * @param frequencyLimit - per-tool override; falls back to DEFAULT_FREQUENCY_LIMIT (20)
 */
export function checkToolLoop(name: string, argsJson: string, frequencyLimit?: number): string | null {
  const limit = frequencyLimit ?? DEFAULT_FREQUENCY_LIMIT;
  const count = (toolCallCounts.get(name) ?? 0) + 1;
  toolCallCounts.set(name, count);

  if (count >= limit) {
    console.warn("[tools] Frequency limit reached: %s called %d times this conversation", name, count);
    return `Tool ${name} has been called ${count} times this conversation. You appear to be stuck — try a different approach or ask the user for help.`;
  }

  const fingerprint = `${name}:${argsJson.slice(0, 500)}`;
  recentFingerprints.push(fingerprint);

  if (recentFingerprints.length > LOOP_THRESHOLD) {
    recentFingerprints = recentFingerprints.slice(-LOOP_THRESHOLD);
  }

  if (recentFingerprints.length >= LOOP_THRESHOLD && recentFingerprints.every((fp) => fp === fingerprint)) {
    console.warn("[tools] Loop detected: %s called %d times with same args", name, LOOP_THRESHOLD);
    recentFingerprints = [];
    return `Loop detected: you've called ${name} with the same arguments ${LOOP_THRESHOLD} times in a row. Try a different approach.`;
  }

  return null;
}

export function resetLoopDetection(): void {
  recentFingerprints = [];
  toolCallCounts.clear();
}
