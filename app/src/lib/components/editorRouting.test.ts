import { describe, expect, it } from "vitest";
import { createSessionTab, createFileTab, createViewTab } from "../domain/contracts";
import { activeViewKind, isSessionEditorPaneActive } from "./editorRouting";

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

  describe("activeViewKind", () => {
    it("returns the view kind when a view tab is selected", () => {
      const tabs = [
        createFileTab("tab-1", "doc-1"),
        createViewTab("tab-2", "settings"),
        createViewTab("tab-3", "themes"),
      ];
      expect(activeViewKind(tabs, "tab-2")).toBe("settings");
      expect(activeViewKind(tabs, "tab-3")).toBe("themes");
    });

    it("returns null for file/session tabs and missing selection", () => {
      const tabs = [createFileTab("tab-1", "doc-1"), createSessionTab("tab-2", "agent-a")];
      expect(activeViewKind(tabs, "tab-1")).toBeNull();
      expect(activeViewKind(tabs, "tab-2")).toBeNull();
      expect(activeViewKind(tabs, null)).toBeNull();
      expect(activeViewKind(tabs, "tab-missing")).toBeNull();
    });
  });
});
