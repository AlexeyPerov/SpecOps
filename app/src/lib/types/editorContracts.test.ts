import { describe, expect, it } from "vitest";
import type {
  EditorActionName,
  EditorCommandCapability,
  EditorDomainActions,
  EditorDomainQueries,
  EditorHost,
  EditorHostIdentity,
} from "../types/editor";
import { SELECT_NEXT_OCCURRENCE_BINDING_DECISION } from "../types/editor";

/**
 * Compile-time / smoke coverage for M0.1/M0.4 editor host contracts.
 * Ensures grouped domain APIs and extension-point action names stay
 * typecheckable without requiring a live workbench runtime.
 */
describe("editor host contracts", () => {
  it("accepts a typed host with grouped domain actions and capability reporting", () => {
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
      history: {
        undo: unavailable,
        redo: unavailable,
      },
      selection: {
        indent: unavailable,
        outdent: unavailable,
        selectNextOccurrence: unavailable,
        selectAllOccurrences: unavailable,
        skipOccurrence: unavailable,
        undoOccurrence: unavailable,
      },
      lines: {
        moveLineUp: unavailable,
        moveLineDown: unavailable,
        duplicateLine: unavailable,
        joinLines: unavailable,
      },
      navigation: {
        goToLine: () => unavailable(),
      },
      search: {
        findNext: () => unavailable(),
        findPrevious: () => unavailable(),
        replaceCurrent: () => unavailable(),
        replaceAndFindNext: () => unavailable(),
        replaceAll: () => unavailable(),
        setSearchQuery: () => unavailable(),
      },
      view: {
        setWrap: () => unavailable(),
        setZoom: () => unavailable(),
      },
    } satisfies EditorDomainActions;

    const queries = {
      history: {
        canUndo: () => unavailable(),
        canRedo: () => unavailable(),
      },
      selection: {
        getSelection: () => unavailable(),
      },
      document: {
        getDocumentContent: () => unavailable(),
      },
      search: {
        getMatchInfo: () => unavailable(),
      },
    } satisfies EditorDomainQueries;

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
    expect(host.actions.history.undo()).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(host.actions.lines.duplicateLine()).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(host.queries.search.getMatchInfo("x", false)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("documents the M2 Cmd/Ctrl+D ownership transfer", () => {
    expect(SELECT_NEXT_OCCURRENCE_BINDING_DECISION.chord.mac).toBe("Cmd+D");
    expect(SELECT_NEXT_OCCURRENCE_BINDING_DECISION.previousOwner).toBe(
      "edit.duplicateLine",
    );
    expect(SELECT_NEXT_OCCURRENCE_BINDING_DECISION.owner).toBe(
      "edit.selectNextOccurrence",
    );
  });
});
