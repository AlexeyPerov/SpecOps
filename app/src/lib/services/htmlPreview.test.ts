import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildHtmlPreview, attachHtmlPreviewLinks } from "./htmlPreview";
import { openMarkdownPreviewLink } from "./markdownPreviewLinks";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `https://asset.localhost/${encodeURIComponent(path)}`,
}));
vi.mock("./markdownPreviewLinks", () => ({
  openMarkdownPreviewLink: vi.fn(async () => ({ kind: "opened-local" })),
  describeMarkdownPreviewLinkResult: () => null,
}));

beforeEach(() => vi.clearAllMocks());

describe("HTML preview", () => {
  it("keeps full-page CSS, relative stylesheets and image paths resolved from the file", () => {
    const html = buildHtmlPreview('<html lang="ru"><head><style>body{background:red}</style><link rel="stylesheet" href="css/site.css"></head><body><img src="images/photo.png"><h1>Gallery</h1></body></html>', '/tmp/mock ups/gallery.html');
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.documentElement.lang).toBe("ru");
    expect(doc.querySelector("style")?.textContent).toContain("background:red");
    expect(doc.querySelector("base")?.href).toBe("https://asset.localhost//tmp/mock%20ups/gallery.html");
    expect(new URL(doc.querySelector("img")!.getAttribute("src")!, doc.querySelector("base")!.href).href)
      .toBe("https://asset.localhost//tmp/mock%20ups/images/photo.png");
    expect(doc.querySelector("link")?.getAttribute("href")).toBe("css/site.css");
  });

  it("removes active content, redirects, nested frames and source policies before adding its policy", () => {
    const html = buildHtmlPreview('<base href="https://example.com/"><meta http-equiv="refresh" content="0;url=https://example.com"><meta http-equiv="Content-Security-Policy" content="script-src *"><script>parent.alert(1)</script><iframe src="/"></iframe><object data="/"></object><embed src="/"><p>Safe</p>', '/tmp/page.html');
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll("script, iframe, object, embed")).toHaveLength(0);
    expect(doc.querySelectorAll("base")).toHaveLength(1);
    expect(doc.querySelectorAll("meta[http-equiv]")).toHaveLength(1);
    expect(doc.head.firstElementChild?.getAttribute("content")).toContain("default-src 'none'");
    expect(doc.body.textContent).toBe("Safe");
  });

  it("uses no application-relative base for unsaved HTML", () => {
    expect(buildHtmlPreview("<p>Hello</p>", null)).toContain('href="about:blank"');
  });

  it("opens relative links in app tabs even for target=_blank and modified clicks, then disposes handlers", async () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<a href="images/photo.png" target="_blank"><span>Photo</span></a>';
    const notify = vi.fn();
    const dispose = attachHtmlPreviewLinks(doc, { filePath: '/tmp/gallery.html', windowId: "main", notify });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    doc.querySelector("span")!.dispatchEvent(click);
    await Promise.resolve();
    expect(click.defaultPrevented).toBe(true);
    expect(openMarkdownPreviewLink).toHaveBeenCalledWith({ href: "images/photo.png", documentFilePath: '/tmp/gallery.html', windowId: "main" });
    dispose();
    doc.querySelector("span")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(openMarkdownPreviewLink).toHaveBeenCalledTimes(1);
  });

  it("scrolls fragments locally and refuses executable URLs", () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<a href="#section">Jump</a><h2 id="section">Section</h2><a href="javascript:alert(1)">Bad</a>';
    const scroll = vi.fn();
    doc.getElementById("section")!.scrollIntoView = scroll;
    const notify = vi.fn();
    const dispose = attachHtmlPreviewLinks(doc, { filePath: '/tmp/page.html', windowId: "main", notify });
    doc.querySelectorAll("a").forEach((a) => a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(scroll).toHaveBeenCalledOnce();
    expect(openMarkdownPreviewLink).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Link could not be opened.");
    dispose();
  });
});
