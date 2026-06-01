<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import DocumentEditor from "./DocumentEditor.svelte";
  import type { EditorLanguageId } from "../editor/editorLanguage";
  import type { EditorCommandRunner } from "../types/editor";
  import {
    describeMarkdownPreviewLinkResult,
    handleMarkdownPreviewLinkClick,
  } from "../services/markdownPreviewLinks";

  export let content = "";
  export let documentId: string | null = null;
  export let documentFilePath: string | null = null;
  export let scrollTop = 0;
  export let language: EditorLanguageId = "markdown";
  export let wrapLines = false;
  export let zoomPercent = 100;
  export let decoratePlaintextSymbols = true;
  export let markdownHtml = "";
  export let storedMarkdownViewMode: "edit" | "split" | "preview" = "edit";
  export let canFitSplit = true;
  export let windowId = "main";
  export let onStatusMessage: (message: string) => void = () => {};
  export let onMarkdownViewModeChange: (mode: "edit" | "split" | "preview") => void = () => {};
  export let onUntitledTitleRefresh: ((documentId: string) => void) | undefined = undefined;
  export let onScrollTopChange: (documentId: string, scrollTop: number) => void = () => {};
  export let registerEditorCommandRunner: ((runner: EditorCommandRunner) => void) | undefined =
    undefined;

  let markdownEditorPaneEl: HTMLDivElement | null = null;
  let markdownPreviewPaneEl: HTMLDivElement | null = null;
  let splitScrollCleanup: (() => void) | null = null;

  $: markdownViewMode =
    storedMarkdownViewMode === "split" && !canFitSplit ? "edit" : storedMarkdownViewMode;

  $: if (markdownViewMode === "split") {
    void setupSplitScrollSync();
  } else {
    teardownSplitScrollSync();
  }

  function teardownSplitScrollSync(): void {
    splitScrollCleanup?.();
    splitScrollCleanup = null;
  }

  function syncByRatio(source: HTMLElement, target: HTMLElement): void {
    const sourceScrollable = source.scrollHeight - source.clientHeight;
    const targetScrollable = target.scrollHeight - target.clientHeight;
    if (sourceScrollable <= 0 || targetScrollable <= 0) {
      if (target.scrollTop !== 0) {
        target.scrollTop = 0;
      }
      return;
    }
    const ratio = source.scrollTop / sourceScrollable;
    const nextScrollTop = Math.round(ratio * targetScrollable);
    if (Math.abs(target.scrollTop - nextScrollTop) <= 1) {
      return;
    }
    target.scrollTop = nextScrollTop;
  }

  async function setupSplitScrollSync(): Promise<void> {
    teardownSplitScrollSync();
    await tick();

    const editorScroller = markdownEditorPaneEl?.querySelector(".cm-scroller") as HTMLElement | null;
    const previewScroller = markdownPreviewPaneEl;
    if (!editorScroller || !previewScroller) {
      return;
    }

    const onEditorScroll = (event: Event): void => {
      if (!event.isTrusted) {
        return;
      }
      syncByRatio(editorScroller, previewScroller);
    };

    const onPreviewScroll = (event: Event): void => {
      if (!event.isTrusted) {
        return;
      }
      syncByRatio(previewScroller, editorScroller);
    };

    editorScroller.addEventListener("scroll", onEditorScroll, { passive: true });
    previewScroller.addEventListener("scroll", onPreviewScroll, { passive: true });
    syncByRatio(editorScroller, previewScroller);

    splitScrollCleanup = () => {
      editorScroller.removeEventListener("scroll", onEditorScroll);
      previewScroller.removeEventListener("scroll", onPreviewScroll);
    };
  }

  async function onMarkdownPreviewClick(event: MouseEvent): Promise<void> {
    const result = await handleMarkdownPreviewLinkClick(event, {
      documentFilePath,
      windowId,
    });
    if (!result) {
      return;
    }
    const message = describeMarkdownPreviewLinkResult(result);
    if (message) {
      onStatusMessage(message);
    }
  }

  onDestroy(() => {
    teardownSplitScrollSync();
  });
</script>

<div class="markdown-layout">
  <div class="markdown-mode-bar">
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

  {#if markdownViewMode === "preview"}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="markdown-preview markdown-preview-standalone" onclick={onMarkdownPreviewClick}>
      {@html markdownHtml}
    </div>
  {:else if markdownViewMode === "split"}
    <div class="markdown-split">
      <div class="markdown-editor-pane" bind:this={markdownEditorPaneEl}>
        <DocumentEditor
          {content}
          {documentId}
          {scrollTop}
          {wrapLines}
          {zoomPercent}
          {language}
          {decoratePlaintextSymbols}
          {onStatusMessage}
          {onUntitledTitleRefresh}
          {onScrollTopChange}
          {registerEditorCommandRunner}
        />
      </div>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="markdown-preview markdown-preview-pane"
        bind:this={markdownPreviewPaneEl}
        onclick={onMarkdownPreviewClick}
      >
        {@html markdownHtml}
      </div>
    </div>
  {:else}
    <div class="markdown-editor-single">
      <DocumentEditor
        {content}
        {documentId}
        {scrollTop}
        {wrapLines}
        {zoomPercent}
        {language}
        {decoratePlaintextSymbols}
        {onStatusMessage}
        {onUntitledTitleRefresh}
        {onScrollTopChange}
        {registerEditorCommandRunner}
      />
    </div>
  {/if}
</div>

<style>
  .markdown-layout {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
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

  .markdown-editor-single {
    flex: 1;
    min-height: 0;
  }

  .markdown-split {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-8);
  }

  .markdown-editor-pane {
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
</style>
