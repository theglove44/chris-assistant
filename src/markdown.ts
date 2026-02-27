/**
 * Converts standard Markdown (as output by AI models) to Telegram HTML format.
 *
 * Telegram HTML supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="...">
 * Only &, <, > need escaping in plain text.
 */

/** Escape HTML special characters in plain text. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Strip Markdown formatting to produce clean plain text.
 * Used as a fallback when HTML parsing fails in Telegram.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\w]*\n?([\s\S]*?)```/g, "$1")  // fenced code blocks
    .replace(/`([^`\n]+)`/g, "$1")                // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")      // links → link text only
    .replace(/^#{1,6} /gm, "")                    // headers
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")        // bold-italic
    .replace(/\*\*([^*]+)\*\*/g, "$1")            // bold
    .replace(/\*([^*\n]+)\*/g, "$1")              // italic
    .replace(/^> ?/gm, "");                        // blockquotes
}

/**
 * Convert standard Markdown to Telegram HTML.
 */
export function toMarkdownV2(text: string): string {
  let processed = text;

  // --- Step 1: Extract fenced code blocks ---
  const codeBlocks: string[] = [];
  processed = processed.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const placeholder = `\x00CODE${codeBlocks.length}\x00`;
    const escapedCode = escapeHtml(code);
    if (lang) {
      codeBlocks.push(`<pre><code class="language-${escapeHtml(lang)}">${escapedCode}</code></pre>`);
    } else {
      codeBlocks.push(`<pre>${escapedCode}</pre>`);
    }
    return placeholder;
  });

  // --- Step 2: Extract inline code ---
  processed = processed.replace(/`([^`\n]+)`/g, (_match, code) => {
    const placeholder = `\x00CODE${codeBlocks.length}\x00`;
    codeBlocks.push(`<code>${escapeHtml(code)}</code>`);
    return placeholder;
  });

  // --- Step 3: Escape HTML in remaining text (before adding HTML tags) ---
  processed = processed.replace(/[^&<>\x00-\x08\x0e-\x1f]|[\x00-\x08\x0e-\x1f]/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    return char;
  });

  // --- Step 4: Convert links [text](url) ---
  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
    return `<a href="${url}">${linkText}</a>`;
  });

  // --- Step 5: Convert headers ---
  processed = processed.replace(/^#{1,6} (.+)$/gm, (_match, headerText) => {
    return `<b>${headerText}</b>`;
  });

  // --- Step 6: Convert bold-italic ***text*** ---
  processed = processed.replace(/\*\*\*([^*]+)\*\*\*/g, (_match, inner) => {
    return `<b><i>${inner}</i></b>`;
  });

  // --- Step 7: Convert bold **text** ---
  processed = processed.replace(/\*\*([^*]+)\*\*/g, (_match, inner) => {
    return `<b>${inner}</b>`;
  });

  // --- Step 8: Convert italic *text* ---
  processed = processed.replace(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, (_match, inner) => {
    return `<i>${inner}</i>`;
  });

  // --- Step 9: Convert blockquotes ---
  processed = processed.replace(/^&gt; ?(.*)$/gm, (_match, content) => {
    return `<blockquote>${content}</blockquote>`;
  });

  // --- Step 10: Restore code placeholders ---
  processed = processed.replace(/\x00CODE(\d+)\x00/g, (_match, idx) => {
    return codeBlocks[parseInt(idx, 10)];
  });

  return processed;
}
