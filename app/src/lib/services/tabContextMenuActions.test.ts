import { describe, expect, it } from "vitest";
import type { DocumentState, TabState } from "../domain/contracts";
import { createFileTab } from "../domain/contracts";
import {
  canCloseMissingFileTabs,
  canCloseOtherTabs,
  canCloseTabsToRight,
  canCopyRelativePath,
  canCopyTabPath,
  canOpenNearbyFiles,
  canRenameTab,
  canRevealTabInFileManager,
  collectTabOpenPaths,
  tabDocumentForTab,
} from "./tabContextMenuActions";

function doc(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    id: "doc-1",
    title: "a.txt",
    filePath: "/tmp/ws/a.txt",
    content: "hello",
    savedContent: "hello",
    isDirty: false,
    contentKind: "text",
    language: "plaintext",
    encoding: "utf-8",
    lineEnding: "lf",
    diskFingerprint: null,
    dismissedFingerprint: null,
    fileMissing: false,
    scrollTop: 0,
    markdownViewMode: "edit",
    ...overrides,
  };
}

function tabs(): TabState[] {
  return [
    createFileTab("tab-1", "doc-1"),
    createFileTab("tab-2", "doc-2"),
    createFileTab("tab-3", "doc-3", true),
    createFileTab("tab-4", "doc-4"),
  ];
}

describe("tabContextMenuActions", () => {
  it("resolves tab documents and collects unique open paths", () => {
    const documents = [
      doc({ id: "doc-1", filePath: "/tmp/ws/a.txt" }),
      doc({ id: "doc-2", filePath: "/tmp/ws/b.txt" }),
      doc({ id: "doc-3", filePath: "/tmp/ws/c.txt" }),
      doc({ id: "doc-4", filePath: null }),
    ];

    expect(tabDocumentForTab(tabs()[0], documents)?.filePath).toBe("/tmp/ws/a.txt");
    expect(collectTabOpenPaths(tabs(), documents)).toEqual([
      "/tmp/ws/a.txt",
      "/tmp/ws/b.txt",
      "/tmp/ws/c.txt",
    ]);
  });

  it("enables reveal and nearby actions only when the tab has a file path", () => {
    const withPath = doc();
    const withoutPath = doc({ filePath: null });

    expect(canRevealTabInFileManager(tabs()[0], [withPath])).toBe(true);
    expect(canRevealTabInFileManager(tabs()[0], [withoutPath])).toBe(false);
    expect(canOpenNearbyFiles(withPath)).toBe(true);
    expect(canOpenNearbyFiles(withoutPath)).toBe(false);
  });

  it("gates close-other and close-to-right actions around pinned tabs", () => {
    const openTabs = tabs();
    const contextTab = openTabs[1];

    expect(canCloseOtherTabs(openTabs, contextTab)).toBe(true);
    expect(canCloseTabsToRight(openTabs, contextTab)).toBe(true);
    expect(canCloseTabsToRight(openTabs, openTabs[3])).toBe(false);
    expect(canCloseOtherTabs(openTabs, null)).toBe(false);
  });

  it("enables close-missing only when an unpinned tab points at a missing file", () => {
    const openTabs = tabs();
    const documents = [
      doc({ id: "doc-1" }),
      doc({ id: "doc-2" }),
      doc({ id: "doc-3", fileMissing: true }),
      doc({ id: "doc-4", fileMissing: true }),
    ];

    expect(canCloseMissingFileTabs(openTabs, documents)).toBe(true);
    expect(canCloseMissingFileTabs([createFileTab("tab-1", "doc-4", true)], documents)).toBe(
      false,
    );
  });

  it("enables copy-path and relative-path actions based on workspace membership", () => {
    const withPath = doc({ filePath: "/tmp/ws/a.txt" });

    expect(canCopyTabPath(withPath)).toBe(true);
    expect(canCopyTabPath(doc({ filePath: null }))).toBe(false);
    expect(canCopyRelativePath("/tmp/ws/a.txt", "/tmp/ws")).toBe(true);
    expect(canCopyRelativePath("/tmp/outside.txt", "/tmp/ws")).toBe(false);
    expect(canCopyRelativePath("/tmp/ws/a.txt", null)).toBe(false);
  });

  it("enables rename only for on-disk tabs that are not missing", () => {
    const tab = tabs()[0];

    expect(canRenameTab(tab, doc())).toBe(true);
    expect(canRenameTab(tab, doc({ filePath: null }))).toBe(false);
    expect(canRenameTab(tab, doc({ fileMissing: true }))).toBe(false);
  });
});
