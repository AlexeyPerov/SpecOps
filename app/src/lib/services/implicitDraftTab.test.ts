import { describe, expect, it } from "vitest";
import { createFileTab } from "../domain/contracts";
import {
  createImplicitDraftPair,
  isReplaceableBootstrapTab,
  isTabVisibleInStrip,
  revealTabInStrip,
} from "./implicitDraftTab";
import { buildEmptyUnsavedDocument } from "../state/appState/documentHelpers";

describe("implicitDraftTab helpers", () => {
  it("createImplicitDraftPair seeds stripHidden on tab and empty document", () => {
    const { tab, document } = createImplicitDraftPair("tab-a", "doc-a");
    expect(tab.stripHidden).toBe(true);
    expect(document.content).toBe("");
    expect(document.filePath).toBeNull();
  });

  it("isTabVisibleInStrip hides empty stripHidden file tabs", () => {
    const tab = createFileTab("tab-a", "doc-a", false, true);
    const emptyDoc = buildEmptyUnsavedDocument("doc-a");
    expect(isTabVisibleInStrip(tab, emptyDoc)).toBe(false);
  });

  it("isTabVisibleInStrip reveals file tabs once document has content", () => {
    const tab = createFileTab("tab-a", "doc-a", false, true);
    const doc = { ...buildEmptyUnsavedDocument("doc-a"), content: "typed" };
    expect(isTabVisibleInStrip(tab, doc)).toBe(true);
  });

  it("isTabVisibleInStrip always shows session and view tabs", () => {
    expect(
      isTabVisibleInStrip({ id: "s", kind: "session", sessionId: "x", pinned: false }),
    ).toBe(true);
    expect(
      isTabVisibleInStrip({ id: "v", kind: "view", view: "settings", pinned: false }),
    ).toBe(true);
  });

  it("isReplaceableBootstrapTab matches lone empty unsaved file tabs", () => {
    const tab = createFileTab("tab-a", "doc-a", false, true);
    expect(isReplaceableBootstrapTab(tab, buildEmptyUnsavedDocument("doc-a"))).toBe(true);
    expect(
      isReplaceableBootstrapTab(tab, { ...buildEmptyUnsavedDocument("doc-a"), content: "x" }),
    ).toBe(false);
  });

  it("revealTabInStrip clears stripHidden", () => {
    const hidden = createFileTab("tab-a", "doc-a", false, true);
    const revealed = revealTabInStrip(hidden);
    expect(revealed.stripHidden).toBe(false);
    expect(revealTabInStrip(revealed)).toBe(revealed);
  });
});
