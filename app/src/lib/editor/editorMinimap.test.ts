import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { showMinimap, type MinimapConfig } from "@replit/codemirror-minimap";
import { minimapExtension } from "./editorMinimap";

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
});
