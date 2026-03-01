/**
 * Tests for toMarkdownV2 — the standard Markdown → Telegram HTML converter.
 *
 * Despite the legacy function name, this converter outputs Telegram HTML
 * (parse_mode: "HTML") since the codebase switched from MarkdownV2 to HTML.
 * Only &, <, > need escaping in plain text. Tags: <b>, <i>, <code>, <pre>, <a>.
 */
import { describe, it, expect } from "vitest";
import { toMarkdownV2, stripMarkdown } from "../src/markdown.js";

describe("toMarkdownV2 (Telegram HTML output)", () => {
  describe("plain text escaping", () => {
    it("escapes ampersand in plain text", () => {
      expect(toMarkdownV2("A & B")).toBe("A &amp; B");
    });

    it("escapes angle brackets in plain text", () => {
      expect(toMarkdownV2("a < b > c")).toBe("a &lt; b &gt; c");
    });

    it("passes through plain text with no special chars unchanged", () => {
      expect(toMarkdownV2("Hello world")).toBe("Hello world");
    });

    it("does not escape dots, parens, hyphens, or exclamation marks", () => {
      // HTML mode doesn't need to escape these (MarkdownV2 did)
      expect(toMarkdownV2("Hello! Version 1.0.0")).toBe("Hello! Version 1.0.0");
      expect(toMarkdownV2("foo(bar)")).toBe("foo(bar)");
      expect(toMarkdownV2("step-by-step")).toBe("step-by-step");
    });
  });

  describe("italic conversion (*text*)", () => {
    it("converts *text* to <i>text</i>", () => {
      expect(toMarkdownV2("*italic text*")).toBe("<i>italic text</i>");
    });

    it("handles italic mid-sentence", () => {
      expect(toMarkdownV2("This is *really* good")).toBe("This is <i>really</i> good");
    });
  });

  describe("bold conversion (**text**)", () => {
    it("converts **text** to <b>text</b>", () => {
      expect(toMarkdownV2("**bold text**")).toBe("<b>bold text</b>");
    });

    it("handles **text** mid-sentence", () => {
      expect(toMarkdownV2("This is **important** stuff")).toBe(
        "This is <b>important</b> stuff",
      );
    });
  });

  describe("bold-italic conversion (***text***)", () => {
    it("converts ***text*** to <b><i>text</i></b>", () => {
      expect(toMarkdownV2("***bold italic***")).toBe("<b><i>bold italic</i></b>");
    });
  });

  describe("inline code", () => {
    it("wraps inline code in <code> tags", () => {
      expect(toMarkdownV2("`npm install`")).toBe("<code>npm install</code>");
    });

    it("escapes HTML inside inline code", () => {
      expect(toMarkdownV2("`a < b & c`")).toBe("<code>a &lt; b &amp; c</code>");
    });

    it("does not convert markdown formatting inside inline code", () => {
      const result = toMarkdownV2("`**not bold**`");
      expect(result).toBe("<code>**not bold**</code>");
    });

    it("surrounding plain text is unaffected", () => {
      const result = toMarkdownV2("Run `git status` and check.");
      expect(result).toContain("<code>git status</code>");
      expect(result).toContain("and check.");
    });
  });

  describe("fenced code blocks", () => {
    it("wraps fenced code blocks in <pre> tags", () => {
      const result = toMarkdownV2("```\nconsole.log('hi')\n```");
      expect(result).toContain("<pre>");
      expect(result).toContain("console.log(");
    });

    it("escapes HTML inside code blocks", () => {
      const result = toMarkdownV2("```\na < b & c\n```");
      expect(result).toContain("a &lt; b &amp; c");
    });

    it("preserves the language tag on fenced code blocks", () => {
      const result = toMarkdownV2("```typescript\nconst x = 1;\n```");
      expect(result).toContain('class="language-typescript"');
    });

    it("does not escape MarkdownV2 special chars inside code blocks", () => {
      // . ( ) ! are not special in HTML — should appear literally (HTML-escaped only)
      const result = toMarkdownV2("```\nfoo.bar() + baz!\n```");
      expect(result).toContain("foo.bar() + baz!");
    });
  });

  describe("link conversion", () => {
    it("converts links to <a> tags", () => {
      const result = toMarkdownV2("[click here](https://example.com)");
      expect(result).toBe('<a href="https://example.com">click here</a>');
    });

    it("preserves link text content", () => {
      const result = toMarkdownV2("[hello world](https://example.com)");
      expect(result).toContain("hello world");
      expect(result).toContain("https://example.com");
    });
  });

  describe("blockquotes", () => {
    it("converts '> text' to <blockquote>", () => {
      const result = toMarkdownV2("> some text");
      expect(result).toBe("<blockquote>some text</blockquote>");
    });
  });

  describe("header conversion", () => {
    it("converts # Header to <b>", () => {
      expect(toMarkdownV2("# My Header")).toBe("<b>My Header</b>");
    });

    it("converts ## Header to <b>", () => {
      expect(toMarkdownV2("## Section Title")).toBe("<b>Section Title</b>");
    });

    it("converts ### Header to <b>", () => {
      expect(toMarkdownV2("### Subsection")).toBe("<b>Subsection</b>");
    });
  });

  describe("combined content", () => {
    it("handles code next to plain text", () => {
      const result = toMarkdownV2("Run `git status` and check.");
      expect(result).toContain("<code>git status</code>");
      expect(result).toContain("and check.");
    });

    it("handles plain text with trailing period", () => {
      const result = toMarkdownV2("Use npm install to set up.");
      expect(result).toBe("Use npm install to set up.");
    });

    it("handles multiple formatting types", () => {
      const result = toMarkdownV2("Use **bold** and *italic* and `code`");
      expect(result).toContain("<b>bold</b>");
      expect(result).toContain("<i>italic</i>");
      expect(result).toContain("<code>code</code>");
    });
  });
});

describe("stripMarkdown", () => {
  it("strips bold markers", () => {
    expect(stripMarkdown("**bold**")).toBe("bold");
  });

  it("strips italic markers", () => {
    expect(stripMarkdown("*italic*")).toBe("italic");
  });

  it("strips inline code backticks", () => {
    expect(stripMarkdown("`code`")).toBe("code");
  });

  it("strips fenced code blocks", () => {
    expect(stripMarkdown("```js\ncode\n```")).toBe("code\n");
  });

  it("strips links to text only", () => {
    expect(stripMarkdown("[click](https://example.com)")).toBe("click");
  });

  it("strips headers", () => {
    expect(stripMarkdown("# Header")).toBe("Header");
  });

  it("strips blockquotes", () => {
    expect(stripMarkdown("> quoted")).toBe("quoted");
  });
});
