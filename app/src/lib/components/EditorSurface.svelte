<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { EditorLanguageId } from "../editor/editorLanguage";
  import { getEditorDocumentSessionCache } from "../editor/editorDocumentSessionContext";
  import {
    createEditorViewController,
    type EditorViewController,
  } from "../editor/editorViewController";
  import { getEditorWorkbenchRuntime } from "../editor/editorWorkbenchContext";
  import { logDiagnostic } from "../services/logging";
  import type { ContextId } from "../domain/contracts";

  interface Props {
    content?: string;
    documentId?: string | null;
    paneId: string;
    /** Active context id — namespaces the editor host/session cache so contexts
     *  with overlapping pane/document ids do not collide when multiple editor
     *  trees stay mounted across a context switch. */
    contextId: ContextId;
    scrollTop?: number;
    wrapLines?: boolean;
    zoomPercent?: number;
    language?: EditorLanguageId;
    decoratePlaintextSymbols?: boolean;
    showMinimap?: boolean;
    showFoldGutter?: boolean;
    autoClosePairs?: boolean;
    autoSuggest?: boolean;
    enabledSnippets?: import("../domain/snippets").ResolvedMarkdownSnippet[];
    onStatusMessage?: (message: string) => void;
    onDocumentDirty?: (nextContent: string) => void;
    onScrollTopChange?: (documentId: string, scrollTop: number) => void;
  }

  let {
    content = "",
    documentId = null,
    paneId,
    contextId,
    scrollTop = 0,
    wrapLines = false,
    zoomPercent = 100,
    language = "plaintext",
    decoratePlaintextSymbols = true,
    showMinimap = true,
    showFoldGutter = true,
    autoClosePairs = true,
    autoSuggest = false,
    enabledSnippets = [],
    onStatusMessage = () => {},
    onDocumentDirty = () => {},
    onScrollTopChange = () => {},
  }: Props = $props();

  const workbench = getEditorWorkbenchRuntime();
  const sessionCache = getEditorDocumentSessionCache();

  let hostEl = $state<HTMLDivElement | undefined>(undefined);
  let controller: EditorViewController | undefined;

  onMount(() => {
    if (!hostEl) {
      return;
    }

    controller = createEditorViewController({
      workbench,
      sessionCache,
      onStatusMessage: (message) => onStatusMessage(message),
      onDocumentDirty: (nextContent) => onDocumentDirty(nextContent),
      onScrollTopChange: (id, nextScrollTop) => onScrollTopChange(id, nextScrollTop),
    });
    controller.update({
      content,
      documentId,
      paneId,
      contextId,
      scrollTop,
      wrapLines,
      zoomPercent,
      language,
      decoratePlaintextSymbols,
      showMinimap,
      showFoldGutter,
      autoClosePairs,
      autoSuggest,
      enabledSnippets,
    });
    controller.mount(hostEl);

    void logDiagnostic({
      level: "debug",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "EditorSurface mounted",
      metadata: { documentId, paneId },
    });
  });

  onDestroy(() => {
    controller?.destroy();
    controller = undefined;

    void logDiagnostic({
      level: "debug",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "EditorSurface destroyed",
      metadata: { documentId, paneId },
    });
  });

  $effect(() => {
    controller?.update({
      content,
      documentId,
      paneId,
      contextId,
      scrollTop,
      wrapLines,
      zoomPercent,
      language,
      decoratePlaintextSymbols,
      showMinimap,
      showFoldGutter,
      autoClosePairs,
      autoSuggest,
      enabledSnippets,
    });
  });
</script>

<div bind:this={hostEl} class="editor-host"></div>

<style>
  .editor-host {
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border-radius: var(--radius-md);
    overflow: hidden;
    border: 1px solid var(--color-border-subtle);
  }
</style>
