import { describe, expect, it, beforeEach } from "vitest";
import {
  invalidateChatMarkdown,
  renderChatMarkdown,
} from "./chatMarkdown";

describe("renderChatMarkdown", () => {
  beforeEach(() => {
    invalidateChatMarkdown();
  });

  it("renders headings, paragraphs, and emphasis", () => {
    const result = renderChatMarkdown("# Title\n\nSome **bold** and _italic_ text.");
    expect(result.html).toContain("<h1>");
    expect(result.html).toContain("<strong>bold</strong>");
    expect(result.html).toContain("<em>italic</em>");
  });

  it("renders GFM tables and task lists", () => {
    const md = [
      "- [x] done",
      "- [ ] todo",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");
    const { html } = renderChatMarkdown(md);
    // GFM task lists emit checkboxes.
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
  });

  it("wraps fenced code blocks with language label and highlight.js classes", () => {
    const md = "```ts\nconst x: number = 1;\n```";
    const { html, codeBlockCount } = renderChatMarkdown(md);
    expect(codeBlockCount).toBe(1);
    expect(html).toContain('class="chat-code"');
    expect(html).toContain("hljs");
    expect(html).toContain("language-ts");
    expect(html).toContain('data-lang="ts"');
  });

  it("auto-detects language when no fence info is given", () => {
    const md = "```\nconst x = 1;\n```";
    const { html } = renderChatMarkdown(md);
    expect(html).toContain('class="chat-code"');
    // Auto-detection assigns some language class (highlight.js picks the best
    // match from its common subset — exact choice is not asserted here).
    expect(html).toMatch(/language-[a-z0-9]+/);
    expect(html).toContain("hljs");
  });

  it("strips <script> tags and javascript: URLs", () => {
    const md = '<script>alert(1)</script>\n\n[bad](javascript:alert(1))';
    const { html } = renderChatMarkdown(md);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:alert");
  });

  it("strips inline event handlers", () => {
    const md = '<a href="https://example.com" onclick="alert(1)">x</a>';
    const { html } = renderChatMarkdown(md);
    // DOMPurify keeps the href but drops the handler. marked may have escaped
    // the raw HTML depending on config, so we only assert the dangerous bit
    // is gone either way.
    expect(html).not.toContain("onclick");
  });

  it("escapes HTML entities in code content (no raw execution)", () => {
    const md = "```html\n<img src=x onerror=alert(1)>\n```";
    const { html } = renderChatMarkdown(md);
    expect(html).not.toContain("onerror=alert");
  });

  it("memoizes identical inputs", () => {
    const a = renderChatMarkdown("# Memo");
    const b = renderChatMarkdown("# Memo");
    expect(b).toBe(a);
  });

  it("force bypasses the memo cache", () => {
    const a = renderChatMarkdown("# Memo");
    const b = renderChatMarkdown("# Memo", true);
    expect(b).not.toBe(a);
    expect(b.html).toBe(a.html);
  });

  it("respects breaks: single newlines become <br>", () => {
    const { html } = renderChatMarkdown("line one\nline two");
    expect(html).toContain("<br>");
  });
});
