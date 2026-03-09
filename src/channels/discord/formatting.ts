export function splitDiscordMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n\n", maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) {
      splitAt = remaining.lastIndexOf(". ", maxLength);
      if (splitAt !== -1) splitAt += 1;
    }
    if (splitAt === -1 || splitAt < maxLength / 2) {
      splitAt = maxLength;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

export function toDiscordMarkdown(text: string): string {
  return text.replace(/^#{1,6} (.+)$/gm, "**$1**");
}
