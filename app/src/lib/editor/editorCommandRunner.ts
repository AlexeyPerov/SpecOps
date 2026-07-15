/**
 * Flat command-runner facade over grouped domain APIs.
 * Prefer `createEditorHost` / `EditorDomainActions` for new code; this remains
 * for fixtures and anything that still speaks the flat runner shape.
 */
import type { Compartment } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { EditorCommandRunner, EditorHost } from "../types/editor";
import { createEditorDomainApis } from "./editorDomainApis";
import { editorHostToCommandRunner } from "./editorHostFactory";

export type CreateEditorCommandRunnerOptions = {
  getView: () => EditorView | undefined;
  lineWrapCompartment: Compartment;
  fontSizeCompartment: Compartment;
  searchHighlightCompartment: Compartment;
  onStatusMessage: (message: string) => void;
  updateCursor: () => void;
};

export function createEditorCommandRunner(
  opts: CreateEditorCommandRunnerOptions,
): EditorCommandRunner {
  const { actions, queries, capability } = createEditorDomainApis({
    ...opts,
    getLanguage: () => "plaintext",
    findEnabledSnippet: () => undefined,
  });
  const host: EditorHost = {
    identity: { paneId: "", documentId: null, generation: 0 },
    actions,
    queries,
    capability,
    focus: () => {
      opts.getView()?.focus();
    },
  };
  return editorHostToCommandRunner(host);
}

export { applyWrap, applyZoom } from "./editorExtensions";
