<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { readFile } from "@tauri-apps/plugin-fs";
  import DocumentEditor from "./DocumentEditor.svelte";
  import type { EditorLanguageId } from "../editor/editorLanguage";
  import type { EditorCommandRunner } from "../types/editor";
  import { mimeTypeForImagePath } from "../services/imagePreviewSrc";
  import {
    describeMarkdownPreviewLinkResult,
    handleMarkdownPreviewLinkClick,
  } from "../services/markdownPreviewLinks";
  import { emptySet, emptyWeakSet } from "../collections/emptyCollections";

  export let content = "";
  export let documentId: string | null = null;
  export let documentFilePath: string | null = null;
  export let scrollTop = 0;
  export let language: EditorLanguageId = "markdown";
  export let wrapLines = false;
  export let zoomPercent = 100;
  export let decoratePlaintextSymbols = true;
  export let markdownEnabled = true;
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
  let standalonePreviewEl: HTMLDivElement | null = null;
  let splitScrollCleanup: (() => void) | null = null;
  /** Object URLs we created as image fallbacks, revoked when the doc changes. */
  let fallbackObjectUrls = emptySet<string>();

  $: markdownViewMode = !markdownEnabled
    ? "edit"
    : storedMarkdownViewMode === "split" && !canFitSplit
      ? "edit"
      : storedMarkdownViewMode;

  // Revoke blob fallbacks from the previous document before wiring the new one.
  $: documentId, revokeFallbackUrls();

  $: if (markdownViewMode === "split") {
    void setupSplitScrollSync();
  } else {
    teardownSplitScrollSync();
  }

  // After the preview HTML is (re)injected, wire a blob fallback onto every
  // local image so it still renders if the asset-protocol `src` fails to load
  // (mirrors ImagePreviewPane.svelte's readFile → blob: onerror path). Attaching
  // via addEventListener is CSP-safe (script-src has no 'unsafe-inline').
  $: markdownHtml, markdownViewMode, void wireImageFallbacks();

  async function wireImageFallbacks(): Promise<void> {
    await tick();
    const panes = [markdownPreviewPaneEl, standalonePreviewEl];
    const handled = emptyWeakSet<HTMLImageElement>();
    for (const pane of panes) {
      if (!pane) continue;
      for (const img of pane.querySelectorAll<HTMLImageElement>("img[data-md-local-path]")) {
        if (handled.has(img)) continue;
        handled.add(img);
        attachImageFallback(img);
      }
    }
  }

  function attachImageFallback(img: HTMLImageElement): void {
    const localPath = img.getAttribute("data-md-local-path");
    if (!localPath || img.dataset.mdFallbackWired === "1") return;
    img.dataset.mdFallbackWired = "1";
    img.addEventListener("error", () => {
      void loadBlobFallback(img, localPath);
    });
  }

  async function loadBlobFallback(img: HTMLImageElement, localPath: string): Promise<void> {
    // Already swapped to a blob URL for this image.
    if (img.src.startsWith("blob:")) return;
    try {
      const bytes = await readFile(localPath);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: mimeTypeForImagePath(localPath) }),
      );
      fallbackObjectUrls.add(url);
      img.src = url;
    } catch {
      // Leave the broken asset-protocol src; nothing more we can do.
    }
  }

  function revokeFallbackUrls(): void {
    for (const url of fallbackObjectUrls) {
      URL.revokeObjectURL(url);
    }
    fallbackObjectUrls.clear();
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
    revokeFallbackUrls();
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
      onclick={onMarkdownPreviewClick}
    >
      {@html markdownHtml}
    </div>
  {:else}
    <div class:markdown-split={markdownEnabled && markdownViewMode === "split"} class="markdown-body">
      <div class="markdown-editor-pane" class:markdown-editor-single={markdownViewMode !== "split"} bind:this={markdownEditorPaneEl}>
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
      {#if markdownEnabled && markdownViewMode === "split"}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="markdown-preview markdown-preview-pane"
          bind:this={markdownPreviewPaneEl}
          onclick={onMarkdownPreviewClick}
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
