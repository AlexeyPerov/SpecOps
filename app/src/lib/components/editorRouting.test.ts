import { describe, expect, it } from "vitest";
import { createAgentTab, createFileTab } from "../domain/contracts";
import { isAgentEditorPaneActive } from "./editorRouting";

describe("editor routing", () => {
  it("shows chat pane when an agent tab is selected", () => {
    const tabs = [createFileTab("tab-1", "doc-1"), createAgentTab("tab-2", "agent-a")];
    expect(isAgentEditorPaneActive(tabs, "tab-1")).toBe(false);
    expect(isAgentEditorPaneActive(tabs, "tab-2")).toBe(true);
  });

  it("does not show chat pane when selection is missing", () => {
    const tabs = [createAgentTab("tab-1", "agent-a")];
    expect(isAgentEditorPaneActive(tabs, null)).toBe(false);
    expect(isAgentEditorPaneActive(tabs, "tab-missing")).toBe(false);
  });
});
