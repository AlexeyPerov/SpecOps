/**
 * Rewrites markdown image sources so local images render inside the document
 * preview/split panes.
 *
 * Why this exists: `marked.parse()` emits `<img src>` verbatim. Relative paths
 * then resolve against the app origin (broken), and the Tauri CSP blocks
 * `file://`. We resolve local image paths against the document's directory and
 * feed them through `convertFileSrc`, which yields a CSP-allowed
 * `http://asset.localhost/...` URL — the same trick used by
 * `ImagePreviewPane.svelte` for standalone image previews.
 *
 * As a safety net, the resolved local filesystem path is also stamped onto the
 * rendered `<img>` as `data-md-local-path`. `MarkdownEditorPane.svelte` reads
 * that attribute and, when the primary `src` fails to load, falls back to
 * reading the bytes via the `fs` plugin and showing a `blob:` URL — mirroring
 * `ImagePreviewPane.svelte`'s `onerror` fallback. The data attribute carries
 * no executable content, so it is CSP-safe.
 */
import { Marked, type Token, type Tokens } from "marked";
import { convertFileSrc } from "@tauri-apps/api/core";
import { filePathFromFileUrl } from "./markdownPreviewLinks";

/** Schemes that browsers load directly and that the CSP already admits. */
const PASSTHROUGH_SCHEME = /^(https?:|data:|blob:|asset:)/i;

/** `/abs/path` (Unix) or `C:\...` / `C:/...` (Windows drive). */
const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/])/;

/** Returns the directory portion of a path, using `/` as the separator. */
function dirnameOf(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return "";
  }
  return normalized.slice(0, slash);
}

/** Joins a base directory and a (possibly `./`-prefixed) segment with `/`. */
function joinPath(directory: string, segment: string): string {
  const cleanSegment = segment.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!directory) {
    return cleanSegment;
  }
  if (directory.endsWith("/")) {
    return `${directory}${cleanSegment}`;
  }
  return `${directory}/${cleanSegment}`;
}

/** Resolves a markdown image href to a filesystem path, or null if it isn't local. */
export function resolveLocalImagePath(
  href: string,
  documentFilePath: string | null,
): string | null {
  const trimmed = href.trim();
  if (!trimmed || PASSTHROUGH_SCHEME.test(trimmed)) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("file:")) {
    return filePathFromFileUrl(trimmed);
  }
  if (ABSOLUTE_PATH.test(trimmed)) {
    return trimmed;
  }
  if (documentFilePath) {
    return joinPath(dirnameOf(documentFilePath), trimmed);
  }
  return null;
}

/**
 * Resolves a markdown image `src` to a value the app can actually load.
 *
 * - Remote/data/blob/asset URLs pass through untouched (the CSP governs them).
 * - `file://`, absolute paths, and relative paths resolve to a local filesystem
 *   path, which is wrapped with {@link convertFileSrc} so it is served via
 *   Tauri's asset protocol under the configured `img-src` scope. Relative paths
 *   resolve against the document's directory (only when the document is saved).
 */
export function resolveMarkdownImageSrc(
  href: string,
  documentFilePath: string | null,
): string {
  const localPath = resolveLocalImagePath(href, documentFilePath);
  if (!localPath) {
    return href;
  }
  return convertFileSrc(localPath);
}

/** Escape function matching marked's attribute escaping. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Custom field we stash on image tokens during `walkTokens`. */
interface ImageTokenWithLocalPath extends Tokens.Image {
  localPath?: string | null;
}

/** Matches an HTML `<img ...>` tag, capturing the inner attribute span. */
const RAW_IMG_TAG = /<img\b([^>]*)>/gi;
/** Within an img tag's attribute span, captures the quote char and the src value. */
const SRC_ATTR = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/**
 * Rewrites `src` attributes on raw HTML `<img>` tags so local images embedded
 * as HTML (rather than markdown `![]()` syntax) also resolve and render.
 *
 * Raw HTML flows through marked as opaque `html` tokens, so the `walkTokens`
 * hook never visits them — this post-processes the rendered string. Markdown-
 * generated images are already rewritten (and carry a passthrough-scheme src),
 * so this function is a no-op for them and safe to run over the whole output.
 *
 * Resolved local paths are stamped onto the tag as `data-md-local-path` so the
 * blob fallback in `MarkdownEditorPane.svelte` picks them up. All other
 * attributes (width, alt, align, …) are preserved untouched.
 */
function rewriteRawHtmlImageSources(html: string, documentFilePath: string | null): string {
  return html.replace(RAW_IMG_TAG, (wholeTag, attrSpan: string) => {
    const match = SRC_ATTR.exec(attrSpan);
    if (!match) {
      return wholeTag;
    }
    const quote = match[1] !== undefined ? '"' : match[2] !== undefined ? "'" : "";
    const rawSrc = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    const localPath = resolveLocalImagePath(rawSrc, documentFilePath);
    if (!localPath) {
      return wholeTag;
    }
    const newSrc = `${quote}${convertFileSrc(localPath)}${quote}`;
    let newAttrSpan: string;
    if (quote) {
      newAttrSpan = attrSpan.replace(match[0], `src=${newSrc}`);
    } else {
      // Bare value: replace the captured src=… run, keeping the surrounding spacing.
      newAttrSpan = attrSpan.replace(match[0], `src=${newSrc}`);
    }
    // Stamp the local path for the blob fallback, unless already present.
    if (!/\bdata-md-local-path\b/i.test(newAttrSpan)) {
      newAttrSpan = `${newAttrSpan} data-md-local-path="${escapeAttr(localPath)}"`;
    }
    return `<img${newAttrSpan}>`;
  });
}

/**
 * Renders a markdown document to HTML, rewriting image sources via
 * {@link resolveMarkdownImageSrc} and stamping local paths onto the rendered
 * `<img>` as `data-md-local-path` (for the component's blob fallback).
 *
 * Uses an isolated `Marked` instance so it never disturbs the global `marked`
 * configured by `chatMarkdown.ts` (GFM/breaks/code-highlighting). Marked
 * defaults are used here (GFM on, breaks off) to match prior document-rendering
 * behavior.
 */
export function renderDocumentMarkdown(
  content: string,
  documentFilePath: string | null,
): string {
  const instance = new Marked({
    walkTokens(token: Token): void {
      if (token.type !== "image") {
        return;
      }
      const image = token as ImageTokenWithLocalPath;
      const localPath = resolveLocalImagePath(image.href, documentFilePath);
      image.localPath = localPath;
      if (localPath) {
        image.href = convertFileSrc(localPath);
      }
    },
    renderer: {
      image({ href, title, text, localPath }: ImageTokenWithLocalPath): string {
        const alt = escapeAttr(text ?? "");
        let html = `<img src="${escapeAttr(href)}" alt="${alt}"`;
        if (title) {
          html += ` title="${escapeAttr(title)}"`;
        }
        if (localPath) {
          html += ` data-md-local-path="${escapeAttr(localPath)}"`;
        }
        return `${html}>`;
      },
    },
  });
  const html = instance.parse(content, { async: false }) as string;
  return rewriteRawHtmlImageSources(html, documentFilePath);
}
