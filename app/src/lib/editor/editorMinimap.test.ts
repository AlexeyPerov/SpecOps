import { describe, expect, it } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { showMinimap, type MinimapConfig } from "@replit/codemirror-minimap";
import {
  MINIMAP_MAX_DOC_CHARS,
  MINIMAP_MAX_DOC_LINES,
  isMinimapAffordable,
  minimapExtension,
} from "./editorMinimap";

describe("minimapExtension", () => {
  it("provides a minimap config when enabled", () => {
    const state = EditorState.create({ extensions: [minimapExtension(true)] });
    const config = state.facet(showMinimap);
    expect(config).not.toBeNull();
    expect((config as MinimapConfig).displayText).toBe("characters");
    expect((config as MinimapConfig).showOverlay).toBe("always");
    expect(typeof (config as MinimapConfig).create).toBe("function");
  });

  it("provides null when disabled so the package renders no minimap", () => {
    const state = EditorState.create({ extensions: [minimapExtension(false)] });
    expect(state.facet(showMinimap)).toBeNull();
  });

  it("shares one extension instance per enabled value", () => {
    // The provider is a plain value; allocating a fresh one per editor state is
    // pure waste.
    expect(minimapExtension(true)).toBe(minimapExtension(true));
    expect(minimapExtension(false)).toBe(minimapExtension(false));
  });

  it("classifies documents against both size limits", () => {
    expect(isMinimapAffordable(Text.of(["small"]))).toBe(true);
    expect(isMinimapAffordable(Text.of(["x".repeat(MINIMAP_MAX_DOC_CHARS + 1)]))).toBe(false);
    expect(isMinimapAffordable(Text.of(new Array(MINIMAP_MAX_DOC_LINES + 1).fill("")))).toBe(false);
  });

  it("disables itself above the line limit even when enabled", () => {
    // The package's line index is rebuilt for the whole document on every
    // change; past the limit that per-keystroke cost outweighs the minimap.
    const state = EditorState.create({
      doc: Text.of(new Array(MINIMAP_MAX_DOC_LINES + 1).fill("line")),
      extensions: [minimapExtension(true)],
    });
    expect(state.facet(showMinimap)).toBeNull();
  });

  it("re-enables itself when an edit brings the document back under the limit", () => {
    const oversized = Text.of(new Array(MINIMAP_MAX_DOC_LINES + 1).fill("line"));
    const state = EditorState.create({
      doc: oversized,
      extensions: [minimapExtension(true)],
    });
    expect(state.facet(showMinimap)).toBeNull();

    const trimmed = state.update({
      changes: { from: 0, to: state.doc.length, insert: "line" },
    }).state;
    expect(trimmed.facet(showMinimap)).not.toBeNull();
  });
});
