import { dirname, isAbsolute, resolve } from "@tauri-apps/api/path";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  describeOpenActivePathResult,
  openActivePath,
  type OpenActivePathResult,
} from "./openActivePath";
import { getErrorMessage } from "../commands/commandErrors";

export type MarkdownLinkHrefKind =
  | "external"
  | "fragment"
  | "file-url"
  | "absolute-path"
  | "relative";

export type MarkdownPreviewLinkResult =
  | { kind: "opened-external"; url: string }
  | { kind: "opened-local"; openResult: OpenActivePathResult }
  | { kind: "fragment" }
  | { kind: "no-document" }
  | { kind: "unsupported" }
  | { kind: "failed"; reason: string };

const EXTERNAL_PROTOCOL = /^(https?:|mailto:|tel:)/i;

export function classifyMarkdownLinkHref(href: string): MarkdownLinkHrefKind {
  const trimmed = href.trim();
  if (!trimmed || trimmed === "#") {
    return "fragment";
  }
  if (trimmed.startsWith("#")) {
    return "fragment";
  }
  if (EXTERNAL_PROTOCOL.test(trimmed)) {
    return "external";
  }
  if (trimmed.toLowerCase().startsWith("file:")) {
    return "file-url";
  }
  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return "absolute-path";
  }
  return "relative";
}

export function filePathFromFileUrl(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "file:") {
      return null;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:/.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname || null;
  } catch {
    return null;
  }
}

export async function resolveLocalMarkdownLinkPath(
  documentFilePath: string,
  href: string,
): Promise<string> {
  const trimmed = href.trim();
  if (await isAbsolute(trimmed)) {
    return resolve(trimmed);
  }
  const directory = await dirname(documentFilePath);
  return resolve(directory, trimmed);
}

export async function openMarkdownPreviewLink(input: {
  href: string;
  documentFilePath: string | null;
  windowId: string;
}): Promise<MarkdownPreviewLinkResult> {
  const kind = classifyMarkdownLinkHref(input.href);

  if (kind === "fragment") {
    return { kind: "fragment" };
  }

  if (kind === "external") {
    try {
      await openUrl(input.href.trim());
      return { kind: "opened-external", url: input.href.trim() };
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      return { kind: "failed", reason };
    }
  }

  let localPath: string | null = null;
  if (kind === "file-url") {
    localPath = filePathFromFileUrl(input.href);
    if (!localPath) {
      return { kind: "unsupported" };
    }
  } else if (kind === "absolute-path") {
    localPath = input.href.trim();
  } else if (!input.documentFilePath) {
    return { kind: "no-document" };
  } else {
    try {
      localPath = await resolveLocalMarkdownLinkPath(input.documentFilePath, input.href);
    } catch (error: unknown) {
      const reason = getErrorMessage(error);
      return { kind: "failed", reason };
    }
  }

  const openResult = await openActivePath(localPath, input.windowId);
  return { kind: "opened-local", openResult };
}

export function describeMarkdownPreviewLinkResult(
  result: MarkdownPreviewLinkResult,
): string | null {
  switch (result.kind) {
    case "opened-external":
      return null;
    case "opened-local":
      return describeOpenActivePathResult(result.openResult);
    case "fragment":
      return null;
    case "no-document":
      return "Save the file before opening relative links.";
    case "unsupported":
      return "Link could not be opened.";
    case "failed":
      return `Failed to open link: ${result.reason}`;
    default:
      return null;
  }
}

function findMarkdownPreviewAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  if (!target || typeof (target as Element).closest !== "function") {
    return null;
  }
  const anchor = (target as Element).closest("a[href]");
  if (!anchor || anchor.tagName !== "A") {
    return null;
  }
  const href = anchor.getAttribute("href");
  if (!href?.trim()) {
    return null;
  }
  return anchor as HTMLAnchorElement;
}

export function shouldHandleMarkdownPreviewLinkClick(event: MouseEvent): boolean {
  if (event.defaultPrevented) {
    return false;
  }
  if (event.button !== 0) {
    return false;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  return findMarkdownPreviewAnchor(event.target) !== null;
}

export async function handleMarkdownPreviewLinkClick(
  event: MouseEvent,
  input: { documentFilePath: string | null; windowId: string },
): Promise<MarkdownPreviewLinkResult | null> {
  if (!shouldHandleMarkdownPreviewLinkClick(event)) {
    return null;
  }
  const anchor = findMarkdownPreviewAnchor(event.target);
  if (!anchor) {
    return null;
  }
  const href = anchor.getAttribute("href");
  if (!href?.trim()) {
    return null;
  }
  event.preventDefault();
  event.stopPropagation();
  return openMarkdownPreviewLink({
    href,
    documentFilePath: input.documentFilePath,
    windowId: input.windowId,
  });
}
