import { describe, expect, it } from "vitest";
import type { EditorHostIdentity } from "../types/editor";
import {
  outlineHostBindingsEqual,
  resolveOutlineHostBinding,
  shouldPublishOutlineSnapshot,
} from "./markdownOutlineHostBinding";

function binding(
  overrides: Partial<EditorHostIdentity> = {},
): EditorHostIdentity {
  return {
    contextId: "notepad",
    paneId: "pane-a",
    documentId: "doc-1",
    generation: 1,
    ...overrides,
  };
}

describe("markdownOutlineHostBinding", () => {
  it("treats matching pane/document/generation as equal", () => {
    expect(outlineHostBindingsEqual(binding(), binding())).toBe(true);
    expect(
      outlineHostBindingsEqual(binding(), binding({ generation: 2 })),
    ).toBe(false);
    expect(
      outlineHostBindingsEqual(binding(), binding({ documentId: "doc-2" })),
    ).toBe(false);
    expect(outlineHostBindingsEqual(binding(), null)).toBe(false);
  });

  it("rejects publishing when the host generation or document is stale", () => {
    const expected = binding({ documentId: "doc-2", generation: 3 });
    expect(shouldPublishOutlineSnapshot(expected, expected)).toBe(true);
    expect(
      shouldPublishOutlineSnapshot(expected, binding({ documentId: "doc-1", generation: 3 })),
    ).toBe(false);
    expect(
      shouldPublishOutlineSnapshot(expected, binding({ documentId: "doc-2", generation: 2 })),
    ).toBe(false);
    expect(shouldPublishOutlineSnapshot(expected, null)).toBe(false);
  });

  it("resolves binding only when host matches the active pane document", () => {
    const host = binding({ documentId: "doc-1", generation: 4 });
    expect(resolveOutlineHostBinding(host, "doc-1", "pane-a")).toEqual(host);
    expect(resolveOutlineHostBinding(host, "doc-2", "pane-a")).toBeNull();
    expect(resolveOutlineHostBinding(host, "doc-1", "pane-b")).toBeNull();
    expect(resolveOutlineHostBinding(null, "doc-1", "pane-a")).toBeNull();
  });

  it("does not publish headings from a previous document after a rapid switch", () => {
    // Simulated race: snapshot captured for doc-1 gen 1, then active binding
    // advances to doc-2 gen 2 before the delayed outline publish runs.
    const staleSnapshot = binding({ documentId: "doc-1", generation: 1 });
    const activeAfterSwitch = binding({ documentId: "doc-2", generation: 2 });
    expect(shouldPublishOutlineSnapshot(activeAfterSwitch, staleSnapshot)).toBe(false);
  });
});
