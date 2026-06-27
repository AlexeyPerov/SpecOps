import { beforeEach, describe, expect, it, vi } from "vitest";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  renderDocumentMarkdown,
  resolveLocalImagePath,
  resolveMarkdownImageSrc,
} from "./markdownImageSrc";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset:${path}`),
}));

const convertFileSrcMock = vi.mocked(convertFileSrc);

beforeEach(() => {
  convertFileSrcMock.mockClear();
});

describe("resolveLocalImagePath", () => {
  it("resolves a relative path against the document directory", () => {
    expect(resolveLocalImagePath("./img.png", "/docs/readme.md")).toBe(
      "/docs/img.png",
    );
    expect(resolveLocalImagePath("img.png", "/docs/readme.md")).toBe(
      "/docs/img.png",
    );
  });

  it("handles nested relative paths", () => {
    expect(
      resolveLocalImagePath("../assets/img.png", "/docs/sub/note.md"),
    ).toBe("/docs/sub/../assets/img.png");
  });

  it("uses an absolute filesystem path as-is", () => {
    expect(resolveLocalImagePath("/abs/path/img.png", "/docs/readme.md")).toBe(
      "/abs/path/img.png",
    );
  });

  it("extracts a path from a file:// URL", () => {
    expect(
      resolveLocalImagePath("file:///tmp/specs/img.png", "/docs/readme.md"),
    ).toBe("/tmp/specs/img.png");
  });

  it("returns null for passthrough schemes", () => {
    expect(
      resolveLocalImagePath("https://example.com/x.png", "/docs/readme.md"),
    ).toBeNull();
    expect(
      resolveLocalImagePath("data:image/png;base64,AAAA", "/docs/readme.md"),
    ).toBeNull();
    expect(
      resolveLocalImagePath("blob:https://self/uuid", "/docs/readme.md"),
    ).toBeNull();
    expect(
      resolveLocalImagePath("asset://localhost/x.png", "/docs/readme.md"),
    ).toBeNull();
  });

  it("returns null for a relative path when the document is unsaved", () => {
    expect(resolveLocalImagePath("./img.png", null)).toBeNull();
  });

  it("returns null for an empty href", () => {
    expect(resolveLocalImagePath("", "/docs/readme.md")).toBeNull();
    expect(resolveLocalImagePath("   ", "/docs/readme.md")).toBeNull();
  });
});

describe("resolveMarkdownImageSrc", () => {
  it("wraps a resolved local path with convertFileSrc", () => {
    expect(resolveMarkdownImageSrc("./img.png", "/docs/readme.md")).toBe(
      "asset:/docs/img.png",
    );
    expect(convertFileSrcMock).toHaveBeenCalledWith("/docs/img.png");
  });

  it("passes passthrough URLs through untouched", () => {
    expect(
      resolveMarkdownImageSrc("https://example.com/x.png", "/docs/readme.md"),
    ).toBe("https://example.com/x.png");
    expect(convertFileSrcMock).not.toHaveBeenCalled();
  });

  it("leaves a relative href untouched when the document is unsaved", () => {
    expect(resolveMarkdownImageSrc("./img.png", null)).toBe("./img.png");
    expect(convertFileSrcMock).not.toHaveBeenCalled();
  });
});

describe("renderDocumentMarkdown", () => {
  it("rewrites a relative image src and stamps the local path", () => {
    const html = renderDocumentMarkdown("![logo](./img.png)", "/docs/readme.md");
    expect(html).toContain('src="asset:/docs/img.png"');
    expect(html).toContain('alt="logo"');
    expect(html).toContain('data-md-local-path="/docs/img.png"');
  });

  it("does not stamp a local path for remote images", () => {
    const html = renderDocumentMarkdown(
      "![badge](https://example.com/badge.png)",
      "/docs/readme.md",
    );
    expect(html).toContain('src="https://example.com/badge.png"');
    expect(html).not.toContain("data-md-local-path");
  });

  it("keeps a title attribute when present", () => {
    const html = renderDocumentMarkdown(
      '![logo](./img.png "my title")',
      "/docs/readme.md",
    );
    expect(html).toContain('title="my title"');
  });

  it("keeps non-image markdown intact", () => {
    const html = renderDocumentMarkdown("# Title\n\nsome **bold** text", null);
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("escapes quotes in the local path", () => {
    const html = renderDocumentMarkdown(
      "![a](./a\"b.png)",
      "/docs/readme.md",
    );
    expect(html).toContain("&quot;");
  });
});
