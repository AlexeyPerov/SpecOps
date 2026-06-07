import { describe, expect, it } from "vitest";
import {
  addRequiredSection,
  nextSelectedIdAfterRemoval,
  normalizeMaxBinaryOpenAsTextFromKb,
  normalizeMaxOpenWithoutConfirmFromKb,
  parseExternalFilesKbInput,
  removeRequiredSection,
  reorderRequiredSections,
  resolveSelectedListItem,
  resolveSelectedListItemId,
  updateRequiredSection,
} from "./settingsPanelActions";

describe("parseExternalFilesKbInput", () => {
  it("parses integer KB strings", () => {
    expect(parseExternalFilesKbInput("200")).toBe(200);
    expect(parseExternalFilesKbInput("0")).toBe(0);
  });

  it("returns null for non-numeric input", () => {
    expect(parseExternalFilesKbInput("")).toBeNull();
    expect(parseExternalFilesKbInput("abc")).toBeNull();
    expect(parseExternalFilesKbInput("12.5")).toBe(12);
  });
});

describe("normalizeMaxBinaryOpenAsTextFromKb", () => {
  it("converts KB to normalized bytes", () => {
    expect(normalizeMaxBinaryOpenAsTextFromKb("200")).toBe(200 * 1024);
  });

  it("clamps below minimum to 1 KB", () => {
    expect(normalizeMaxBinaryOpenAsTextFromKb("0")).toBe(1024);
  });

  it("returns null for invalid input", () => {
    expect(normalizeMaxBinaryOpenAsTextFromKb("not-a-number")).toBeNull();
  });
});

describe("normalizeMaxOpenWithoutConfirmFromKb", () => {
  it("converts KB to normalized bytes", () => {
    expect(normalizeMaxOpenWithoutConfirmFromKb("1024")).toBe(1024 * 1024);
  });

  it("clamps below minimum to 1 KB", () => {
    expect(normalizeMaxOpenWithoutConfirmFromKb("0")).toBe(1024);
  });

  it("returns null for invalid input", () => {
    expect(normalizeMaxOpenWithoutConfirmFromKb("")).toBeNull();
  });
});

describe("resolveSelectedListItemId", () => {
  const ids = ["conn-a", "conn-b", "conn-c"];

  it("keeps a valid selected id", () => {
    expect(resolveSelectedListItemId("conn-b", ids, "conn-a")).toBe("conn-b");
  });

  it("falls back to preferred default when selection is missing", () => {
    expect(resolveSelectedListItemId("missing", ids, "conn-b")).toBe("conn-b");
  });

  it("falls back to first item when selection and default are invalid", () => {
    expect(resolveSelectedListItemId("missing", ids, "also-missing")).toBe("conn-a");
  });

  it("returns null when the list is empty", () => {
    expect(resolveSelectedListItemId(null, [], "conn-a")).toBeNull();
  });
});

describe("resolveSelectedListItem", () => {
  const items = [
    { id: "mode-a", label: "A" },
    { id: "mode-b", label: "B" },
  ];

  it("returns the selected item when present", () => {
    expect(resolveSelectedListItem("mode-b", items)?.label).toBe("B");
  });

  it("returns the first item when selection is null", () => {
    expect(resolveSelectedListItem(null, items)?.id).toBe("mode-a");
  });

  it("returns the first item when selection is stale", () => {
    expect(resolveSelectedListItem("missing", items)?.id).toBe("mode-a");
  });
});

describe("nextSelectedIdAfterRemoval", () => {
  it("keeps selection when a different item is removed", () => {
    expect(nextSelectedIdAfterRemoval("mode-b", "mode-a", ["mode-a", "mode-c"])).toBe("mode-a");
  });

  it("selects the first remaining item when the selected item is removed", () => {
    expect(nextSelectedIdAfterRemoval("mode-a", "mode-a", ["mode-b", "mode-c"])).toBe("mode-b");
  });

  it("clears selection when the removed item was last", () => {
    expect(nextSelectedIdAfterRemoval("mode-a", "mode-a", [])).toBeNull();
  });
});

describe("required section list mutations", () => {
  const sections = ["Intro", "Body", "Outro"];

  it("reorders a section up", () => {
    expect(reorderRequiredSections(sections, 1, -1)).toEqual(["Body", "Intro", "Outro"]);
  });

  it("reorders a section down", () => {
    expect(reorderRequiredSections(sections, 0, 1)).toEqual(["Body", "Intro", "Outro"]);
  });

  it("returns null when reorder is out of bounds", () => {
    expect(reorderRequiredSections(sections, 0, -1)).toBeNull();
    expect(reorderRequiredSections(sections, 2, 1)).toBeNull();
  });

  it("adds a numbered section", () => {
    expect(addRequiredSection(sections)).toEqual(["Intro", "Body", "Outro", "Section 4"]);
  });

  it("updates a section in place", () => {
    expect(updateRequiredSection(sections, 1, "Main")).toEqual(["Intro", "Main", "Outro"]);
  });

  it("removes a section by index", () => {
    expect(removeRequiredSection(sections, 1)).toEqual(["Intro", "Outro"]);
  });
});
