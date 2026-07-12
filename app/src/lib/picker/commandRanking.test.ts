import { describe, expect, it } from "vitest";
import type { PaletteCommandEntry } from "../commands/catalog";
import { rankCommands } from "./commandRanking";

function entry(
  overrides: Partial<PaletteCommandEntry> & Pick<PaletteCommandEntry, "id" | "label" | "category">,
): PaletteCommandEntry {
  return {
    searchTerms: [],
    menuPath: "Hidden/Test",
    paletteVisible: true,
    paletteExcludeReason: null,
    binding: undefined,
    availability: { status: "enabled" },
    runnable: true,
    disabledReason: null,
    displayBinding: null,
    ...overrides,
  };
}

describe("rankCommands", () => {
  const sample: PaletteCommandEntry[] = [
    entry({ id: "file.save", label: "Save", category: "File", displayBinding: "⌘S" }),
    entry({
      id: "app.quickOpenFile",
      label: "Quick Open",
      category: "File",
      searchTerms: ["go to file"],
    }),
    entry({
      id: "edit.undo",
      label: "Undo",
      category: "Edit",
      runnable: false,
      disabledReason: "No active document.",
      availability: { status: "disabled", reason: "No active document." },
    }),
    entry({
      id: "view.focusPane2",
      label: "Focus Pane 2",
      category: "Navigation",
    }),
  ];

  it("orders empty query by category then practical frequency", () => {
    const ids = rankCommands(sample, "").matches.map((match) => match.entry.id);
    expect(ids.indexOf("app.quickOpenFile")).toBeLessThan(ids.indexOf("file.save"));
    expect(ids.indexOf("file.save")).toBeLessThan(ids.indexOf("view.focusPane2"));
    expect(ids.indexOf("view.focusPane2")).toBeLessThan(ids.indexOf("edit.undo"));
  });

  it("keeps disabled commands searchable and sorted after enabled rows", () => {
    const disabled = entry({
      id: "file.open",
      label: "Open File",
      category: "File",
      runnable: false,
      disabledReason: "Open a workspace first.",
      availability: { status: "disabled", reason: "Open a workspace first." },
    });
    const results = rankCommands([...sample, disabled], "open");
    expect(results.matches.some((match) => match.entry.id === "file.open")).toBe(true);
    const enabledIndex = results.matches.findIndex(
      (match) => match.entry.id === "app.quickOpenFile",
    );
    const disabledIndex = results.matches.findIndex((match) => match.entry.id === "file.open");
    expect(enabledIndex).toBeGreaterThanOrEqual(0);
    expect(disabledIndex).toBeGreaterThan(enabledIndex);
  });

  it("matches labels, aliases, and categories", () => {
    const alias = entry({
      id: "app.findInProject",
      label: "Find in Project",
      category: "Edit",
      searchTerms: ["search workspace"],
    });
    expect(rankCommands([alias], "search").matches[0]?.entry.id).toBe("app.findInProject");
    expect(rankCommands([alias], "edit").matches[0]?.entry.id).toBe("app.findInProject");
    expect(rankCommands([alias], "project").matches[0]?.entry.id).toBe("app.findInProject");
  });

  it("returns highlight ranges for label matches", () => {
    const match = rankCommands(sample, "save").matches[0];
    expect(match?.entry.id).toBe("file.save");
    expect(match?.ranges.length).toBeGreaterThan(0);
  });

  it("filters hidden availability rows", () => {
    const hidden = entry({
      id: "view.toggleMarkdownPreview",
      label: "Markdown Preview",
      category: "View",
      availability: { status: "hidden" },
      runnable: false,
      disabledReason: null,
    });
    expect(rankCommands([hidden], "").matches).toEqual([]);
  });

  it("preserves stable ordering for identical empty-query inputs", () => {
    const first = rankCommands(sample, "").matches.map((match) => match.entry.id);
    const second = rankCommands(sample, "").matches.map((match) => match.entry.id);
    expect(first).toEqual(second);
  });
});
