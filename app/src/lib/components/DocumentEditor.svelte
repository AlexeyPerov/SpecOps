<script lang="ts">
  import EditorSurface from "./EditorSurface.svelte";
  import { appSettings } from "../state/appStateSelectors";
  import type { EditorLanguageId } from "../editor/editorLanguage";
  import { listEnabledMarkdownSnippetsMemoized } from "../editor/markdownSnippetSettings";
  import { appState } from "../state/appState";
  import type { ResolvedMarkdownSnippet } from "../domain/snippets";

  /**
   * Stable empty array for the non-markdown path (P03-08-24a). Returning a new
   * `[]` literal on every emit gave the controller a fresh reference each time,
   * re-triggering the snippet/completion compartment key check.
   */
  const EMPTY_SNIPPETS: ResolvedMarkdownSnippet[] = [];

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
  // and forced keep-alive surfaces through needless update churn. The memoized
  // resolver (P03-08-24a) returns the same array reference across unrelated
  // settings emits, so the controller's snippet key check is a no-op then.
  const enabledSnippets = $derived(
    language === "markdown"
      ? listEnabledMarkdownSnippetsMemoized($appSettings.markdownSnippets)
      : EMPTY_SNIPPETS,
  );

  function handleDocumentDirty(nextContent: string): void {
    if (!documentId) {
      return;
    }
    appState.setDocumentContentForContext(contextId, documentId, nextContent);
    if (appState.getSnapshot().contexts.activeContextId === contextId) {
      onUntitledTitleRefresh?.(documentId);
    }
  }

  function handleScrollTopChange(documentId: string, nextScrollTop: number): void {
    if (appState.getSnapshot().contexts.activeContextId === contextId) {
      onScrollTopChange(documentId, nextScrollTop);
      return;
    }
    appState.setDocumentScrollTopForContext(contextId, documentId, nextScrollTop);
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
  onScrollTopChange={handleScrollTopChange}
  {visible}
/>
