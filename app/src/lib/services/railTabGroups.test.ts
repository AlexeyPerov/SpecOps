import { describe, expect, it } from "vitest";
import { createFileTab, createSinglePaneLayout, type DocumentState, type TabGroupId } from "../domain/contracts";
import { createRailTabGroupsSelector, formatTabGroupTabLabel } from "./railTabGroups";

describe("formatTabGroupTabLabel", () => {
  it("formats a file with a parent folder as parent/file.ext", () => {
    expect(formatTabGroupTabLabel("/home/alex/notes/idea.md", "idea.md")).toBe(
      "notes/idea.md",
    );
  });

  it("handles Windows-style backslash paths", () => {
    expect(formatTabGroupTabLabel("C:\\Users\\Alex\\notes\\idea.md", "idea.md")).toBe(
      "notes/idea.md",
    );
  });

  it("returns just the filename when there is no parent folder", () => {
    expect(formatTabGroupTabLabel("/idea.md", "idea.md")).toBe("idea.md");
  });

  it("falls back to title for unsaved documents", () => {
    expect(formatTabGroupTabLabel(null, "Untitled 2")).toBe("Untitled 2");
  });

  it("falls back to Untitled when both path and title are empty", () => {
    expect(formatTabGroupTabLabel(null, "")).toBe("Untitled");
  });

  it("uses only the last two segments for deeply nested paths", () => {
    expect(
      formatTabGroupTabLabel("/a/b/c/d/e/notes.md", "notes.md"),
    ).toBe("e/notes.md");
  });
});

describe("createRailTabGroupsSelector", () => {
  function group(id: TabGroupId, name: string, files: (string | null)[]) {
    const documents = files.map((filePath, index) => ({ id: `${id}-doc-${index}`, filePath, title: filePath?.split("/").pop() ?? "Untitled" }));
    const tabs = documents.map((doc, index) => createFileTab(`${id}-tab-${index}`, doc.id));
    return {
      id,
      name,
      snapshot: {
        documents: documents as unknown as DocumentState[],
        session: { editorLayout: createSinglePaneLayout(tabs, tabs[0]?.id ?? null), lastActiveWindowId: "main", windowBounds: null },
      },
    };
  }

  it("lists counts and the newest saved files per group", () => {
    const select = createRailTabGroupsSelector(2);
    const rows = select([group("tabs-default", "Tabs", ["/a/one.md", null, "/a/two.md", "/b/three.md"])]);
    expect(rows).toEqual([{
      id: "tabs-default",
      name: "Tabs",
      tabCount: 4,
      recentTabs: [
        { tabId: "tabs-default-tab-2", label: "a/two.md" },
        { tabId: "tabs-default-tab-3", label: "b/three.md" },
      ],
    }]);
  });

  it("keeps row and array identity until a group changes", () => {
    const select = createRailTabGroupsSelector();
    const first = group("tabs-default", "Tabs", ["/a/one.md"]);
    const second = group("tabs-2", "Drafts", []);
    const rows = select([first, second]);
    expect(select([{ ...first }, { ...second }])).toBe(rows);
    const renamed = select([first, { ...second, name: "Archive" }]);
    expect(renamed).not.toBe(rows);
    expect(renamed[0]).toBe(rows[0]);
    expect(renamed[1].name).toBe("Archive");
    expect(select([first])).toEqual([rows[0]]);
  });
});
