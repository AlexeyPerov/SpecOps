<script lang="ts">
  import type { MessageDiff } from "../ai/chatDiffs";

  interface Props {
    diff: MessageDiff;
    /** Controlled expanded state so a parent can drive collapse globally. */
    expanded: boolean;
    onToggle?: () => void;
  }

  let { diff, expanded, onToggle }: Props = $props();

  /** Has a file list worth expanding to show. */
  let hasFiles = $derived(Boolean(diff.files && diff.files.length > 0));

  let fileCount = $derived(diff.files?.length ?? 0);

  /** Derive a path/short-hash label for the checkpoint, for the header chip. */
  function shortHash(hash: string | undefined): string {
    if (!hash) {
      return "";
    }
    // OpenCode snapshot hashes are git-style (40 hex). Shorten to 7 chars,
    // matching the conventional `git` short-sha display.
    return hash.length > 12 ? hash.slice(0, 7) : hash;
  }
</script>

<div class="inline-diff">
  <button
    type="button"
    class="inline-diff-header"
    onclick={onToggle}
    aria-expanded={hasFiles ? expanded : undefined}
    disabled={!hasFiles}
  >
    <span class="inline-diff-icon" aria-hidden="true">Δ</span>
    <span class="inline-diff-label">
      {#if diff.snapshot}
        <span class="inline-diff-kind">Checkpoint</span>
        <code class="inline-diff-hash">{shortHash(diff.snapshot)}</code>
      {:else}
        <span class="inline-diff-kind">Changed files</span>
      {/if}
    </span>
    {#if hasFiles}
      <span class="inline-diff-count" title={`${fileCount} changed file${fileCount === 1 ? "" : "s"}`}>
        {fileCount} {fileCount === 1 ? "file" : "files"}
      </span>
      <span class="inline-diff-chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
    {/if}
  </button>

  {#if hasFiles}
    <div class="inline-diff-body-wrapper">
      <ul class="inline-diff-files">
        {#each diff.files ?? [] as file (file)}
          <li class="inline-diff-file" title={file}>
            <code class="inline-diff-file-path">{file}</code>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .inline-diff {
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-accent) 5%, transparent);
    overflow: hidden;
  }

  .inline-diff-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: none;
    background: transparent;
    color: var(--color-text-primary);
    cursor: pointer;
    font-size: 11px;
    line-height: 1.4;
    text-align: left;
  }

  .inline-diff-header:disabled {
    cursor: default;
  }

  .inline-diff-header:not(:disabled):hover {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }

  .inline-diff-icon {
    font-size: 11px;
    width: 1ch;
    text-align: center;
    color: var(--color-accent);
    font-weight: 700;
  }

  .inline-diff-label {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .inline-diff-kind {
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 10px;
    flex-shrink: 0;
  }

  .inline-diff-hash {
    font-family: monospace;
    font-size: 11px;
    color: var(--color-text-primary);
  }

  .inline-diff-count {
    margin-left: auto;
    color: var(--color-text-secondary);
    font-size: 10px;
    flex-shrink: 0;
  }

  .inline-diff-chevron {
    color: var(--color-text-secondary);
    font-size: 10px;
    flex-shrink: 0;
    transition: transform var(--motion-fast) var(--easing-standard);
  }

  /*
   * Animate the body height via grid-template-rows so we don't need to measure
   * the content (same technique as ReasoningBlock / SubtaskCard). Only revealed
   * when the parent reports an expanded state.
   */
  .inline-diff-body-wrapper {
    display: grid;
    grid-template-rows: 0fr;
    transition:
      grid-template-rows var(--motion-medium) var(--easing-standard),
      opacity var(--motion-medium) var(--easing-standard);
    opacity: 0;
  }

  .inline-diff-header[aria-expanded="true"] ~ .inline-diff-body-wrapper {
    grid-template-rows: 1fr;
    opacity: 1;
  }

  .inline-diff-files {
    list-style: none;
    margin: 0;
    padding: 0 var(--space-4) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 0;
    overflow: hidden;
    max-height: 220px;
    overflow-y: auto;
  }

  .inline-diff-file {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .inline-diff-file-path {
    font-family: monospace;
    font-size: 11px;
    line-height: 1.5;
    color: var(--color-text-primary);
    white-space: pre-wrap;
    word-break: break-all;
    overflow-wrap: anywhere;
  }

  @media (prefers-reduced-motion: reduce) {
    .inline-diff-chevron,
    .inline-diff-body-wrapper {
      transition: none;
    }
  }
</style>
