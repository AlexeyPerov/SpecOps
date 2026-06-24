import { describe, expect, it } from "vitest";
import { createSessionTab, createFileTab } from "../domain/contracts";
import { isSessionEditorPaneActive } from "./editorRouting";

describe("editor routing", () => {
  it("shows chat pane when an agent tab is selected", () => {
    const tabs = [createFileTab("tab-1", "doc-1"), createSessionTab("tab-2", "agent-a")];
    expect(isSessionEditorPaneActive(tabs, "tab-1")).toBe(false);
    expect(isSessionEditorPaneActive(tabs, "tab-2")).toBe(true);
  });

  it("does not show chat pane when selection is missing", () => {
    const tabs = [createSessionTab("tab-1", "agent-a")];
    expect(isSessionEditorPaneActive(tabs, null)).toBe(false);
    expect(isSessionEditorPaneActive(tabs, "tab-missing")).toBe(false);
  });
});
