import { convertFileSrc } from "@tauri-apps/api/core";
import { describeMarkdownPreviewLinkResult, openMarkdownPreviewLink } from "./markdownPreviewLinks";

/** Retain the document's CSS and relative assets inside a script-free sandbox. */
export function buildHtmlPreview(content: string, filePath: string | null): string {
  const doc = new DOMParser().parseFromString(content, "text/html");
  doc.querySelectorAll("base, script, iframe, frame, frameset, object, embed, meta[http-equiv]")
    .forEach((element) => element.remove());
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; style-src 'unsafe-inline' asset: http://asset.localhost https://asset.localhost; img-src asset: http://asset.localhost https://asset.localhost data: http: https:; font-src asset: http://asset.localhost https://asset.localhost data:; form-action 'none'";
  const base = doc.createElement("base");
  // Tauri encodes the whole path, including separators. Restore separators so
  // browser URL resolution keeps the document directory for relative resources.
  base.href = filePath
    ? convertFileSrc(filePath.replaceAll("\\", "/")).replace(/%2f/gi, "/")
    : "about:blank";
  doc.head.prepend(policy, base);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

/** Capture modified and middle clicks as well, keeping navigation in app tabs. */
export function attachHtmlPreviewLinks(
  doc: Document,
  options: { filePath: string | null; windowId: string; notify: (message: string) => void },
): () => void {
  const handleClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const anchor = target?.closest?.("a[href], area[href]");
    const href = anchor?.getAttribute("href")?.trim();
    if (!href || (event.type === "auxclick" && event.button !== 1)) return;
    event.preventDefault();
    event.stopPropagation();
    if (href.startsWith("#")) {
      try { doc.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView(); } catch { /* Invalid fragment. */ }
      return;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^(https?:|mailto:|tel:|file:)/i.test(href)) {
      options.notify("Link could not be opened.");
      return;
    }
    void openMarkdownPreviewLink({ href, documentFilePath: options.filePath, windowId: options.windowId })
      .then((result) => {
        const message = describeMarkdownPreviewLinkResult(result);
        if (message) options.notify(message);
      }).catch(() => options.notify("Link could not be opened."));
  };
  doc.addEventListener("click", handleClick);
  doc.addEventListener("auxclick", handleClick);
  return () => {
    doc.removeEventListener("click", handleClick);
    doc.removeEventListener("auxclick", handleClick);
  };
}
