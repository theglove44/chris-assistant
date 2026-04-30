// Telegram stamps every delivery with X-Telegram-Bot-Api-Secret-Token when
// secret_token is set on setWebhook — verifying it rejects forged updates from
// anyone who guesses the public URL but not the secret.
export function verifySecretHeader(
  headerValue: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof headerValue !== "string") return false;
  return headerValue === expected;
}
