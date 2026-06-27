import { describe, expect, it } from "vitest";
import { formatNotepadTabLabel } from "./notepadTabLabel";

describe("formatNotepadTabLabel", () => {
  it("formats a file with a parent folder as parent/file.ext", () => {
    expect(formatNotepadTabLabel("/home/alex/notes/idea.md", "idea.md")).toBe(
      "notes/idea.md",
    );
  });

  it("handles Windows-style backslash paths", () => {
    expect(formatNotepadTabLabel("C:\\Users\\Alex\\notes\\idea.md", "idea.md")).toBe(
      "notes/idea.md",
    );
  });

  it("returns just the filename when there is no parent folder", () => {
    expect(formatNotepadTabLabel("/idea.md", "idea.md")).toBe("idea.md");
  });

  it("falls back to title for unsaved documents", () => {
    expect(formatNotepadTabLabel(null, "Untitled 2")).toBe("Untitled 2");
  });

  it("falls back to Untitled when both path and title are empty", () => {
    expect(formatNotepadTabLabel(null, "")).toBe("Untitled");
  });

  it("uses only the last two segments for deeply nested paths", () => {
    expect(
      formatNotepadTabLabel("/a/b/c/d/e/notes.md", "notes.md"),
    ).toBe("e/notes.md");
  });
});
