<script lang="ts">
  import EditorSurface from "./EditorSurface.svelte";
  import { appState } from "../state/appState";
  import type { EditorLanguageId } from "../editor/editorLanguage";

  let {
    content = "",
    documentId = null,
    paneId,
    scrollTop = 0,
    wrapLines = false,
    zoomPercent = 100,
    language = "plaintext" as EditorLanguageId,
    decoratePlaintextSymbols = true,
    showMinimap = true,
    onStatusMessage = () => {},
    onUntitledTitleRefresh = undefined as
      | ((documentId: string) => void)
      | undefined,
    onScrollTopChange = (_documentId: string, _scrollTop: number) => {},
  }: {
    content?: string;
    documentId?: string | null;
    paneId: string;
    scrollTop?: number;
    wrapLines?: boolean;
    zoomPercent?: number;
    language?: EditorLanguageId;
    decoratePlaintextSymbols?: boolean;
    showMinimap?: boolean;
    onStatusMessage?: (message: string) => void;
    onUntitledTitleRefresh?: ((documentId: string) => void) | undefined;
    onScrollTopChange?: (documentId: string, scrollTop: number) => void;
  } = $props();

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
  {paneId}
  {scrollTop}
  {wrapLines}
  {zoomPercent}
  {language}
  {decoratePlaintextSymbols}
  {showMinimap}
  {onStatusMessage}
  onDocumentDirty={handleDocumentDirty}
  {onScrollTopChange}
/>
