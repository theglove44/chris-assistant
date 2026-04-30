import { timingSafeEqual } from "node:crypto";

// Telegram stamps every delivery with X-Telegram-Bot-Api-Secret-Token when
// secret_token is set on setWebhook — verifying it rejects forged updates from
// anyone who guesses the public URL but not the secret. Compared in constant
// time so an attacker can't probe the secret one byte at a time via timing.
export function verifySecretHeader(
  headerValue: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof headerValue !== "string") return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
