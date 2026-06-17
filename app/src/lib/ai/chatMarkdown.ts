/**
 * Chat markdown rendering — converts assistant text parts to sanitized HTML
 * with syntax-highlighted code blocks.
 *
 * Pipeline: `marked` parses GFM markdown → `highlight.js` decorates code blocks
 * → `DOMPurify` strips anything that could execute or exfiltrate (scripts,
 * event handlers, javascript: URLs, …). The result is safe to inject via
 * `{@html …}`.
 *
 * See `specs/ops/phase-3.5/execution-plan-m1.md` (M1-T10).
 */
import { marked, type Tokens } from "marked";
import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";
import hljs from "highlight.js/lib/common";

/**
 * Result of rendering a markdown string. We cache the rendered HTML per source
 * text so a re-render of a long assistant message is essentially free.
 */
export interface ChatMarkdownResult {
  /** Sanitized HTML ready for `{@html …}`. */
  html: string;
  /** Number of fenced code blocks encountered (used for layout affordances). */
  codeBlockCount: number;
}

/**
 * Highlighted code HTML wrapped in a `<pre><code>` pair with a language label.
 * Replaces marked's default `code()` renderer.
 */
function renderCode(token: Tokens.Code): string {
  const language = (token.lang ?? "").trim();
  let highlighted: string;
  let effectiveLanguage: string;
  if (language && hljs.getLanguage(language)) {
    highlighted = hljs.highlight(token.text, { language, ignoreIllegals: true }).value;
    effectiveLanguage = language;
  } else {
    const auto = hljs.highlightAuto(token.text);
    highlighted = auto.value;
    effectiveLanguage = auto.language ?? language;
  }
  const classes = ["hljs"];
  if (effectiveLanguage) classes.push(`language-${effectiveLanguage}`);
  const label = effectiveLanguage || language || "text";
  return (
    `<pre class="chat-code">` +
    `<code class="${classes.join(" ")}">${highlighted}</code>` +
    `<span class="chat-code-lang" data-lang="${escapeAttribute(label)}">${escapeText(label)}</span>` +
    `</pre>`
  );
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

let markedConfigured = false;

function ensureMarkedConfigured(): void {
  if (markedConfigured) return;
  marked.use({
    gfm: true,
    breaks: true,
    renderer: {
      code(token: Tokens.Code) {
        return renderCode(token);
      },
    },
  });
  markedConfigured = true;
}

const sanitizeConfig: DOMPurifyConfig = {
  // Default allow-list keeps all common markdown-emitted tags (h1-h6, p, ul,
  // ol, li, pre, code, table, …) and strips scripts/handlers. We additionally
  // permit `target` for links and our `data-lang` affordance on code blocks.
  ADD_ATTR: ["target", "data-lang"],
};

const cache = new Map<string, ChatMarkdownResult>();
const CACHE_MAX = 128;

/**
 * Render a markdown source string to sanitized HTML with syntax highlighting.
 *
 * Rendering is memoized by source text — repeated calls with the same input
 * return the same {@link ChatMarkdownResult} instance. Pass `force` to bypass
 * the cache (used in tests).
 */
export function renderChatMarkdown(source: string, force = false): ChatMarkdownResult {
  const trimmed = source ?? "";
  if (!force) {
    const cached = cache.get(trimmed);
    if (cached) return cached;
  }

  ensureMarkedConfigured();
  const rawHtml = marked.parse(trimmed, { async: false }) as string;
  const html = DOMPurify.sanitize(rawHtml, sanitizeConfig) as unknown as string;
  const codeBlockCount = countFencedCodeBlocks(trimmed);

  const result: ChatMarkdownResult = { html, codeBlockCount };
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(trimmed, result);
  return result;
}

function countFencedCodeBlocks(source: string): number {
  const matches = source.match(/^`{3,}/gm);
  if (!matches) return 0;
  return Math.floor(matches.length / 2);
}

/**
 * Drop the memoized HTML for a specific source, or the whole cache when no
 * argument is supplied. Used when long-lived contexts are torn down.
 */
export function invalidateChatMarkdown(source?: string): void {
  if (source === undefined) {
    cache.clear();
    return;
  }
  cache.delete(source);
}
