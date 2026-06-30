import { describe, expect, it } from "vitest";
import { createFileTab, createSinglePaneLayout } from "./contracts";
import { ensureImplicitDraftsInLayout, revealFileTabsInLayout } from "./implicitDraftLayout";
import { createImplicitDraftPair } from "../services/implicitDraftTab";

describe("ensureImplicitDraftsInLayout", () => {
  it("adds a hidden draft to empty panes", () => {
    const layout = createSinglePaneLayout([], null);
    let counter = 0;
    const { layout: next, newDocuments } = ensureImplicitDraftsInLayout(
      layout,
      () => {
        counter += 1;
        return { tabId: `tab-${counter}`, docId: `doc-${counter}` };
      },
      (tabId, documentId) => createImplicitDraftPair(tabId, documentId),
    );
    expect(next.panes[0].tabs).toHaveLength(1);
    expect(next.panes[0].selectedTabId).toBe("tab-1");
    expect(next.panes[0].tabs[0]).toMatchObject({ stripHidden: true });
    expect(newDocuments).toHaveLength(1);
  });

  it("leaves panes with tabs unchanged", () => {
    const layout = createSinglePaneLayout([createFileTab("tab-1", "doc-1")], "tab-1");
    const { layout: next, newDocuments } = ensureImplicitDraftsInLayout(
      layout,
      () => ({ tabId: "tab-x", docId: "doc-x" }),
      (tabId, documentId) => createImplicitDraftPair(tabId, documentId),
    );
    expect(next).toBe(layout);
    expect(newDocuments).toHaveLength(0);
  });
});

describe("revealFileTabsInLayout", () => {
  it("clears stripHidden on tabs bound to the document", () => {
    const hiddenTab = createFileTab("tab-1", "doc-1", false, true);
    const layout = createSinglePaneLayout([hiddenTab], "tab-1");
    const next = revealFileTabsInLayout(layout, "doc-1");
    expect(next.panes[0].tabs[0]).toMatchObject({ stripHidden: false });
  });

  it("returns same layout when nothing to reveal", () => {
    const tab = createFileTab("tab-1", "doc-1");
    const layout = createSinglePaneLayout([tab], "tab-1");
    expect(revealFileTabsInLayout(layout, "doc-1")).toBe(layout);
  });
});
