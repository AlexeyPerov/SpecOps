<script lang="ts">
  import EditorSurface from "./EditorSurface.svelte";
  import { appState } from "../state/appState";
  import type { EditorLanguageId } from "../editor/editorLanguage";
  import type { EditorCommandRunner } from "../types/editor";

  export let content = "";
  export let documentId: string | null = null;
  export let scrollTop = 0;
  export let wrapLines = false;
  export let zoomPercent = 100;
  export let language: EditorLanguageId = "plaintext";
  export let decoratePlaintextSymbols = true;
  export let onStatusMessage: (message: string) => void = () => {};
  export let onUntitledTitleRefresh: ((documentId: string) => void) | undefined = undefined;
  export let onScrollTopChange: (documentId: string, scrollTop: number) => void = () => {};
  export let registerEditorCommandRunner: ((runner: EditorCommandRunner) => void) | undefined =
    undefined;

  function handleDocumentDirty(nextContent: string): void {
    if (!documentId) {
      return;
    }
    appState.setDocumentContent(documentId, nextContent);
    onUntitledTitleRefresh?.(documentId);
  }
</script>

<EditorSurface
  {content}
  {documentId}
  {scrollTop}
  {wrapLines}
  {zoomPercent}
  {language}
  {decoratePlaintextSymbols}
  {onStatusMessage}
  onDocumentDirty={handleDocumentDirty}
  {onScrollTopChange}
  {registerEditorCommandRunner}
/>
