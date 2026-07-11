import { describe, expect, it } from "vitest";
import type {
  EditorActionName,
  EditorActions,
  EditorCommandCapability,
  EditorHost,
  EditorHostIdentity,
  EditorQueries,
} from "../types/editor";
import { SELECT_NEXT_OCCURRENCE_BINDING_DECISION } from "../types/editor";

/**
 * Compile-time / smoke coverage for M0.1 editor host contracts.
 * Ensures extension-point action names and host shape stay typecheckable
 * without requiring a live workbench runtime (M0.2).
 */
describe("editor host contracts", () => {
  it("accepts a typed host with capability reporting", () => {
    const identity: EditorHostIdentity = {
      paneId: "pane-1",
      documentId: "doc-1",
      generation: 1,
    };

    const unavailable = (): { ok: false; reason: "unavailable" } => ({
      ok: false,
      reason: "unavailable",
    });

    const actions = {
      undo: unavailable,
      redo: unavailable,
      indent: unavailable,
      outdent: unavailable,
      moveLineUp: unavailable,
      moveLineDown: unavailable,
      duplicateLine: unavailable,
      joinLines: unavailable,
      setWrap: () => unavailable(),
      setZoom: () => unavailable(),
      findNext: () => unavailable(),
      findPrevious: () => unavailable(),
      replaceCurrent: () => unavailable(),
      replaceAndFindNext: () => unavailable(),
      replaceAll: () => unavailable(),
      setSearchQuery: () => unavailable(),
      goToLine: () => unavailable(),
    } satisfies EditorActions;

    const queries = {
      getMatchInfo: () => unavailable(),
      getSelection: () => unavailable(),
      getDocumentContent: () => unavailable(),
      canUndo: () => unavailable(),
      canRedo: () => unavailable(),
    } satisfies EditorQueries;

    const capability = (action: EditorActionName): EditorCommandCapability => ({
      state: "unavailable",
      reason: `no runtime for ${action}`,
    });

    const host: EditorHost = {
      identity,
      actions,
      queries,
      capability,
      focus: () => {},
    };

    expect(host.identity.generation).toBe(1);
    expect(host.capability("selectNextOccurrence").state).toBe("unavailable");
    expect(host.capability("fold").state).toBe("unavailable");
    expect(host.capability("insertSnippet").state).toBe("unavailable");
    expect(host.capability("toggleBookmark").state).toBe("unavailable");
    expect(host.actions.undo()).toEqual({ ok: false, reason: "unavailable" });
  });

  it("documents the M2 Cmd/Ctrl+D ownership transfer", () => {
    expect(SELECT_NEXT_OCCURRENCE_BINDING_DECISION.chord.mac).toBe("Cmd+D");
    expect(SELECT_NEXT_OCCURRENCE_BINDING_DECISION.currentOwner).toBe(
      "edit.duplicateLine",
    );
  });
});
