/**
 * Converts standard Markdown (as output by AI models) to Telegram MarkdownV2 format.
 *
 * MarkdownV2 special characters that must be escaped in plain text:
 *   _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * Different contexts have different escaping rules:
 *   - Code blocks / inline code: only `\` and `` ` `` need escaping
 *   - Link URLs: only `)` and `\` need escaping
 *   - Everything else: all 18 special chars must be escaped
 */

const SPECIAL_CHARS = /([_*[\]()~`>#+\-=|{}.!\\])/g;
const CODE_SPECIAL_CHARS = /([\\`])/g;
const URL_SPECIAL_CHARS = /([)\\])/g;

/** Escape all MarkdownV2 special characters in plain text. */
function escapePlain(text: string): string {
  return text.replace(SPECIAL_CHARS, "\\$1");
}

/** Escape only what's needed inside code spans/blocks. */
function escapeCode(text: string): string {
  return text.replace(CODE_SPECIAL_CHARS, "\\$1");
}

/** Escape only what's needed inside link URLs. */
function escapeUrl(text: string): string {
  return text.replace(URL_SPECIAL_CHARS, "\\$1");
}

/**
 * Convert standard Markdown to Telegram MarkdownV2.
 *
 * Strategy: extract code blocks and inline code first (replacing them with
 * placeholders), perform the remaining transformations on plain-text regions,
 * then restore placeholders with properly escaped code content.
 */
export function toMarkdownV2(text: string): string {
  const placeholders: string[] = [];

  // --- Step 1: Extract fenced code blocks (```lang\n...\n```) ---
  // Must happen before any other substitution so we don't mangle code content.
  let processed = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const escapedCode = escapeCode(code);
    const placeholder = `\x00CODE${placeholders.length}\x00`;
    placeholders.push("```" + lang + "\n" + escapedCode + "```");
    return placeholder;
  });

  // --- Step 2: Extract inline code (`...`) ---
  processed = processed.replace(/`([^`\n]+)`/g, (_match, code) => {
    const escapedCode = escapeCode(code);
    const placeholder = `\x00CODE${placeholders.length}\x00`;
    placeholders.push("`" + escapedCode + "`");
    return placeholder;
  });

  // --- Step 3: Convert links [text](url) ---
  // Escape link text (all 18 special chars), escape URL (only ) and \).
  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
    const escapedText = escapePlain(linkText);
    const escapedUrl = escapeUrl(url);
    return `[${escapedText}](${escapedUrl})`;
  });

  // --- Step 4: Convert headers (# Header → *Header*) ---
  // Must happen before bold conversion so the `*` we add isn't re-processed.
  // Replace each line that starts with one or more `#` followed by a space.
  processed = processed.replace(/^#{1,6} (.+)$/gm, (_match, headerText) => {
    const escapedText = escapePlain(headerText);
    return `*${escapedText}*`;
  });

  // --- Step 5: Convert bold-italic (***text***) → *_text_* ---
  // Must happen before bold and italic individually.
  processed = processed.replace(/\*\*\*([^*]+)\*\*\*/g, (_match, inner) => {
    const escapedInner = escapePlain(inner);
    return `*_${escapedInner}_*`;
  });

  // --- Step 6: Convert bold (**text**) → *text* ---
  processed = processed.replace(/\*\*([^*]+)\*\*/g, (_match, inner) => {
    const escapedInner = escapePlain(inner);
    return `*${escapedInner}*`;
  });

  // --- Step 7: Convert italic (*text*) → _text_ ---
  // Use a lookahead/lookbehind approach: only match * that are surrounded by
  // non-whitespace content and not adjacent to another *.
  processed = processed.replace(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, (_match, inner) => {
    const escapedInner = escapePlain(inner);
    return `_${escapedInner}_`;
  });

  // --- Step 8: Convert blockquotes (> text → >text) ---
  // MarkdownV2 uses `>` without a required space.
  processed = processed.replace(/^> ?(.*)$/gm, (_match, content) => {
    return ">" + escapePlain(content);
  });

  // --- Step 9: Escape special characters in the remaining plain text ---
  // We must be careful not to double-escape characters we already converted
  // (the MarkdownV2 formatting markers * _ ` [ ] ( ) that we inserted).
  //
  // Approach: split on our inserted MarkdownV2 markers and escape the gaps.
  // The markers we've inserted are:
  //   *text*         (bold)
  //   _text_         (italic)
  //   *_text_*       (bold-italic)
  //   [text](url)    (links — already escaped inside)
  //   >text          (blockquote — already escaped inside)
  //   \x00CODE...\x00 (placeholders)
  //
  // Since step 4-8 already escaped the inner content of each formatted region,
  // we now need to escape the remaining literal text that sits outside of all
  // formatting markers.
  //
  // We do this by tokenising into "formatted" vs "plain" segments.
  processed = escapeOuterPlainText(processed);

  // --- Step 10: Restore code block placeholders ---
  processed = processed.replace(/\x00CODE(\d+)\x00/g, (_match, idx) => {
    return placeholders[parseInt(idx, 10)];
  });

  return processed;
}

/**
 * Escape special characters in the plain-text portions of a string that
 * already contains MarkdownV2 formatting sequences.
 *
 * We walk through the string character by character, tracking whether we're
 * inside a formatting context. Everything outside a formatting context that
 * is not already an escape sequence gets escaped.
 */
function escapeOuterPlainText(text: string): string {
  // Tokenise into segments: formatted spans vs plain text.
  // We recognise the MarkdownV2 sequences we produced in steps 3-8:
  //   *_..._*   bold-italic
  //   *...*     bold
  //   _..._     italic
  //   [...](...) links (already escaped)
  //   >...EOL   blockquotes (already escaped — the content after > up to \n)
  //   \x00CODE\d+\x00  placeholders
  //
  // For the already-escaped spans (links, blockquote content, formatting
  // interiors) we simply pass them through verbatim. For everything else
  // (true plain text between the markers) we apply escapePlain().
  //
  // Regex that matches the formatted sequences we want to pass through:
  const FORMATTED = new RegExp(
    [
      // Placeholders
      "\\x00CODE\\d+\\x00",
      // Bold-italic: *_..._*
      "\\*_[^_]*_\\*",
      // Bold: *...*  (but not *_)
      "\\*[^*_\\n]+\\*",
      // Italic: _..._
      "_[^_\\n]+_",
      // Links: [text](url) — already escaped
      "\\[[^\\]]*\\]\\([^)]*\\)",
      // Blockquote line prefix + content up to end of line
      // We match the `>` followed by anything that was already escaped
      ">([^\\n]*)",
      // Existing escape sequences — pass through without double-escaping
      "\\\\.",
    ].join("|"),
    "gs",
  );

  let result = "";
  let lastIndex = 0;

  for (const match of text.matchAll(FORMATTED)) {
    const matchStart = match.index!;

    // Plain text before this match — escape it
    if (matchStart > lastIndex) {
      result += escapePlain(text.slice(lastIndex, matchStart));
    }

    // Pass the formatted span through verbatim
    result += match[0];
    lastIndex = matchStart + match[0].length;
  }

  // Remaining plain text after the last match
  if (lastIndex < text.length) {
    result += escapePlain(text.slice(lastIndex));
  }

  return result;
}
