<script lang="ts">
  import { tick } from "svelte";
  import DocumentEditor from "./DocumentEditor.svelte";
  import type { EditorLanguageId } from "../editor/editorLanguage";
  import { createMarkdownSplitScrollSync } from "../services/markdownSplitScrollSync";
  import { createMarkdownPreviewImageFallbacks } from "../services/markdownPreviewImageFallbacks";
  import { markdownPreviewLinkAttachment } from "../services/markdownPreviewLinkAttachment";

  let {
    content = "",
    documentId = null as string | null,
    paneId,
    documentFilePath = null as string | null,
    scrollTop = 0,
    language = "markdown" as EditorLanguageId,
    wrapLines = false,
    zoomPercent = 100,
    decoratePlaintextSymbols = true,
    showMinimap = true,
    showFoldGutter = true,
    markdownEnabled = true,
    markdownHtml = "",
    storedMarkdownViewMode = "edit" as "edit" | "split" | "preview",
    canFitSplit = true,
    windowId = "main",
    onStatusMessage = (_message: string) => {},
    onMarkdownViewModeChange = (_mode: "edit" | "split" | "preview") => {},
    onUntitledTitleRefresh = undefined as ((documentId: string) => void) | undefined,
    onScrollTopChange = (_documentId: string, _scrollTop: number) => {},
  }: {
    content?: string;
    documentId?: string | null;
    paneId: string;
    documentFilePath?: string | null;
    scrollTop?: number;
    language?: EditorLanguageId;
    wrapLines?: boolean;
    zoomPercent?: number;
    decoratePlaintextSymbols?: boolean;
    showMinimap?: boolean;
    showFoldGutter?: boolean;
    markdownEnabled?: boolean;
    markdownHtml?: string;
    storedMarkdownViewMode?: "edit" | "split" | "preview";
    canFitSplit?: boolean;
    windowId?: string;
    onStatusMessage?: (message: string) => void;
    onMarkdownViewModeChange?: (mode: "edit" | "split" | "preview") => void;
    onUntitledTitleRefresh?: ((documentId: string) => void) | undefined;
    onScrollTopChange?: (documentId: string, scrollTop: number) => void;
  } = $props();

  // Imperative DOM handles — `$state.raw` so bind:this reassignments notify
  // effects without deep-proxying the element.
  let markdownEditorPaneEl = $state.raw<HTMLDivElement | null>(null);
  let markdownPreviewPaneEl = $state.raw<HTMLDivElement | null>(null);
  let standalonePreviewEl = $state.raw<HTMLDivElement | null>(null);

  const imageFallbacks = createMarkdownPreviewImageFallbacks({
    waitForLayout: () => tick(),
  });

  const markdownViewMode = $derived(
    !markdownEnabled
      ? "edit"
      : storedMarkdownViewMode === "split" && !canFitSplit
        ? "edit"
        : storedMarkdownViewMode,
  );

  const previewLinkAttach = $derived(
    markdownPreviewLinkAttachment({
      getDocumentFilePath: () => documentFilePath,
      getWindowId: () => windowId,
      onStatusMessage,
    }),
  );

  $effect(() => {
    if (markdownViewMode !== "split") {
      return;
    }
    const sync = createMarkdownSplitScrollSync({
      getEditorRoot: () => markdownEditorPaneEl,
      getPreviewScroller: () => markdownPreviewPaneEl,
      waitForLayout: () => tick(),
    });
    return () => {
      sync.dispose();
    };
  });

  $effect(() => {
    documentId;
    markdownHtml;
    markdownViewMode;
    void imageFallbacks.wire([markdownPreviewPaneEl, standalonePreviewEl]);
    return () => {
      imageFallbacks.dispose();
    };
  });
</script>

<div class="markdown-layout">
  <div class="markdown-mode-bar" hidden={!markdownEnabled}>
    <div class="markdown-mode-actions">
      <button
        class={`mode-button ${markdownViewMode === "edit" ? "mode-button-active" : ""}`}
        type="button"
        onclick={() => onMarkdownViewModeChange("edit")}
      >
        edit
      </button>
      <button
        class={`mode-button ${markdownViewMode === "split" ? "mode-button-active" : ""}`}
        type="button"
        onclick={() => onMarkdownViewModeChange("split")}
      >
        split
      </button>
      <button
        class={`mode-button ${markdownViewMode === "preview" ? "mode-button-active" : ""}`}
        type="button"
        onclick={() => onMarkdownViewModeChange("preview")}
      >
        preview
      </button>
    </div>
  </div>

  {#if markdownEnabled && markdownViewMode === "preview"}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="markdown-preview markdown-preview-standalone"
      bind:this={standalonePreviewEl}
      {@attach previewLinkAttach}
    >
      {@html markdownHtml}
    </div>
  {:else}
    <div class:markdown-split={markdownEnabled && markdownViewMode === "split"} class="markdown-body">
      <div class="markdown-editor-pane" class:markdown-editor-single={markdownViewMode !== "split"} bind:this={markdownEditorPaneEl}>
        <DocumentEditor
          {content}
          {documentId}
          {paneId}
          {scrollTop}
          {wrapLines}
          {zoomPercent}
          {language}
          {decoratePlaintextSymbols}
          {showMinimap}
          {showFoldGutter}
          {onStatusMessage}
          {onUntitledTitleRefresh}
          {onScrollTopChange}
        />
      </div>
      {#if markdownEnabled && markdownViewMode === "split"}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="markdown-preview markdown-preview-pane"
          bind:this={markdownPreviewPaneEl}
          {@attach previewLinkAttach}
        >
          {@html markdownHtml}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .markdown-layout {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    gap: 5px;
    min-height: 0;
  }

  .markdown-mode-bar {
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
  }

  .markdown-mode-actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .mode-button {
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    height: 18px;
    font-size: 11px;
    text-transform: lowercase;
    padding: 0 var(--space-6);
  }

  .mode-button-active {
    color: var(--color-text-primary);
    border-color: var(--color-border-subtle);
    background: var(--color-hover);
  }

  .markdown-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .markdown-split {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-8);
  }

  .markdown-editor-pane {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .markdown-preview-pane,
  .markdown-preview-standalone {
    min-height: 0;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    overflow: auto;
  }

  .markdown-preview {
    padding: var(--space-12);
    overflow: auto;
    line-height: 1.55;
  }

  .markdown-preview :global(a[href]) {
    cursor: pointer;
  }

  .markdown-preview :global(img) {
    max-width: 100%;
    border-radius: var(--radius-sm);
  }
</style>
