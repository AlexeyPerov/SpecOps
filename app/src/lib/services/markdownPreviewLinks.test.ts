import { beforeEach, describe, expect, it, vi } from "vitest";
import { dirname, isAbsolute, resolve } from "@tauri-apps/api/path";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  classifyMarkdownLinkHref,
  filePathFromFileUrl,
  handleMarkdownPreviewLinkClick,
  openMarkdownPreviewLink,
  shouldHandleMarkdownPreviewLinkClick,
} from "./markdownPreviewLinks";
import { openActivePath } from "./openActivePath";

vi.mock("@tauri-apps/api/path", () => ({
  dirname: vi.fn(),
  isAbsolute: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("./openActivePath", () => ({
  openActivePath: vi.fn(),
  describeOpenActivePathResult: vi.fn((result: { kind: string; path?: string }) => result.kind),
}));

const dirnameMock = vi.mocked(dirname);
const isAbsoluteMock = vi.mocked(isAbsolute);
const resolveMock = vi.mocked(resolve);
const openUrlMock = vi.mocked(openUrl);
const openActivePathMock = vi.mocked(openActivePath);

describe("classifyMarkdownLinkHref", () => {
  it("classifies external, fragment, file, and path links", () => {
    expect(classifyMarkdownLinkHref("https://example.com")).toBe("external");
    expect(classifyMarkdownLinkHref("http://example.com/docs")).toBe("external");
    expect(classifyMarkdownLinkHref("mailto:hi@example.com")).toBe("external");
    expect(classifyMarkdownLinkHref("#section")).toBe("fragment");
    expect(classifyMarkdownLinkHref("file:///tmp/a.md")).toBe("file-url");
    expect(classifyMarkdownLinkHref("/tmp/a.md")).toBe("absolute-path");
    expect(classifyMarkdownLinkHref("C:\\docs\\a.md")).toBe("absolute-path");
    expect(classifyMarkdownLinkHref("./other.md")).toBe("relative");
  });
});

describe("filePathFromFileUrl", () => {
  it("extracts paths from file URLs", () => {
    expect(filePathFromFileUrl("file:///tmp/specs/a.md")).toBe("/tmp/specs/a.md");
  });
});

describe("openMarkdownPreviewLink", () => {
  beforeEach(() => {
    dirnameMock.mockReset();
    isAbsoluteMock.mockReset();
    resolveMock.mockReset();
    openUrlMock.mockReset();
    openActivePathMock.mockReset();
  });

  it("opens http links in the system browser", async () => {
    openUrlMock.mockResolvedValue(undefined);
    const result = await openMarkdownPreviewLink({
      href: "https://tauri.app/",
      documentFilePath: "/tmp/specs/readme.md",
      windowId: "main",
    });
    expect(openUrlMock).toHaveBeenCalledWith("https://tauri.app/");
    expect(result).toEqual({ kind: "opened-external", url: "https://tauri.app/" });
    expect(openActivePathMock).not.toHaveBeenCalled();
  });

  it("resolves relative links against the markdown file directory", async () => {
    dirnameMock.mockResolvedValue("/tmp/specs");
    isAbsoluteMock.mockResolvedValue(false);
    resolveMock.mockResolvedValue("/tmp/specs/other.md");
    openActivePathMock.mockResolvedValue({ kind: "opened", path: "/tmp/specs/other.md" });

    const result = await openMarkdownPreviewLink({
      href: "./other.md",
      documentFilePath: "/tmp/specs/readme.md",
      windowId: "main",
    });

    expect(resolveMock).toHaveBeenCalledWith("/tmp/specs", "./other.md");
    expect(openActivePathMock).toHaveBeenCalledWith("/tmp/specs/other.md", "main");
    expect(result.kind).toBe("opened-local");
  });

  it("requires a saved file for relative links", async () => {
    const result = await openMarkdownPreviewLink({
      href: "./other.md",
      documentFilePath: null,
      windowId: "main",
    });
    expect(result).toEqual({ kind: "no-document" });
    expect(openActivePathMock).not.toHaveBeenCalled();
  });
});

describe("shouldHandleMarkdownPreviewLinkClick", () => {
  it("accepts plain anchor clicks and rejects modified clicks", () => {
    const anchor = {
      tagName: "A",
      getAttribute: (name: string) => (name === "href" ? "https://example.com" : null),
      closest: (selector: string) => (selector === "a[href]" ? anchor : null),
    };

    const plainClick = {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: { closest: (selector: string) => (selector === "a[href]" ? anchor : null) },
    } as unknown as MouseEvent;

    expect(shouldHandleMarkdownPreviewLinkClick(plainClick)).toBe(true);

    const modifiedClick = { ...plainClick, metaKey: true } as unknown as MouseEvent;
    expect(shouldHandleMarkdownPreviewLinkClick(modifiedClick)).toBe(false);
  });
});

describe("handleMarkdownPreviewLinkClick", () => {
  beforeEach(() => {
    openUrlMock.mockReset();
    openUrlMock.mockResolvedValue(undefined);
    openActivePathMock.mockReset();
  });

  it("prevents default navigation for preview anchor clicks", async () => {
    const anchor = {
      tagName: "A",
      getAttribute: (name: string) => (name === "href" ? "https://example.com" : null),
      closest: (selector: string) => (selector === "a[href]" ? anchor : null),
    };

    const event = {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: { closest: (selector: string) => (selector === "a[href]" ? anchor : null) },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;

    const result = await handleMarkdownPreviewLinkClick(event, {
      documentFilePath: "/tmp/specs/readme.md",
      windowId: "main",
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(result?.kind).toBe("opened-external");
  });
});
