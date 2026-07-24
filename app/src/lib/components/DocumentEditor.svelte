<script lang="ts">
  import EditorSurface from "./EditorSurface.svelte";
  import { appSettings } from "../state/appStateSelectors";
  import type { EditorLanguageId } from "../editor/editorLanguage";
  import { listEnabledMarkdownSnippets } from "../editor/markdownSnippetSettings";
  import { appState } from "../state/appState";

  let {
    content = "",
    documentId = null,
    paneId,
    contextId,
    scrollTop = 0,
    wrapLines = false,
    zoomPercent = 100,
    language = "plaintext" as EditorLanguageId,
    decoratePlaintextSymbols = true,
    showMinimap = true,
    showFoldGutter = true,
    autoClosePairs = true,
    autoSuggest = false,
    onStatusMessage = () => {},
    onUntitledTitleRefresh = undefined as
      | ((documentId: string) => void)
      | undefined,
    onScrollTopChange = (_documentId: string, _scrollTop: number) => {},
    visible = true,
  }: {
    content?: string;
    documentId?: string | null;
    paneId: string;
    contextId: import("../domain/contracts").ContextId;
    scrollTop?: number;
    wrapLines?: boolean;
    zoomPercent?: number;
    language?: EditorLanguageId;
    decoratePlaintextSymbols?: boolean;
    showMinimap?: boolean;
    showFoldGutter?: boolean;
    autoClosePairs?: boolean;
    autoSuggest?: boolean;
    onStatusMessage?: (message: string) => void;
    onUntitledTitleRefresh?: ((documentId: string) => void) | undefined;
    onScrollTopChange?: (documentId: string, scrollTop: number) => void;
    visible?: boolean;
  } = $props();

  // Subscribe to settings only — full `$appState` re-rendered every cursor tick
  // and forced keep-alive surfaces through needless update churn.
  const enabledSnippets = $derived(
    language === "markdown"
      ? listEnabledMarkdownSnippets($appSettings.markdownSnippets)
      : [],
  );

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
  {contextId}
  {scrollTop}
  {wrapLines}
  {zoomPercent}
  {language}
  {decoratePlaintextSymbols}
  {showMinimap}
  {showFoldGutter}
  {autoClosePairs}
  {autoSuggest}
  {enabledSnippets}
  {onStatusMessage}
  onDocumentDirty={handleDocumentDirty}
  {onScrollTopChange}
  {visible}
/>
