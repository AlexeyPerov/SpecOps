<script lang="ts">
  import { consoleLogs, consoleLevelRank } from "../services/appConsole";
  import type { DiagnosticLevel } from "../domain/contracts";
  import EmptyState from "./EmptyState.svelte";

  let {
    /**
     * Minimum level to display (live filter, independent of the append-time
     * retention floor). Entries below this level are hidden from the list and
     * the copy action without being dropped from the ring, so lowering the
     * level again reveals them. Defaults to `debug` (show everything retained).
     */
    minLevel = "debug" as DiagnosticLevel,
  }: {
    minLevel?: DiagnosticLevel;
  } = $props();

  const DISPLAY_MAX_ENTRIES = 250;

  let scrollEl = $state<HTMLDivElement | undefined>(undefined);
  let entries = $derived($consoleLogs);
  // Live display filter: keep only entries at or above the chosen level. Applied
  // before the display cap so the most recent N *visible* entries are rendered.
  let levelFilteredEntries = $derived(
    entries.filter((entry) => consoleLevelRank(entry.level) >= consoleLevelRank(minLevel)),
  );
  let hiddenEntryCount = $derived(
    Math.max(0, levelFilteredEntries.length - DISPLAY_MAX_ENTRIES),
  );
  let visibleEntries = $derived(
    levelFilteredEntries.length > DISPLAY_MAX_ENTRIES
      ? levelFilteredEntries.slice(levelFilteredEntries.length - DISPLAY_MAX_ENTRIES)
      : levelFilteredEntries,
  );
  let stickToBottom = $state(true);

  $effect(() => {
    visibleEntries;
    hiddenEntryCount;
    if (stickToBottom && scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  });

  function handleScroll(): void {
    if (!scrollEl) {
      return;
    }
    const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    stickToBottom = distanceFromBottom < 24;
  }
</script>

<div class="console-logs-panel" aria-hidden="false">
  <div
    class="console-scroll"
    bind:this={scrollEl}
    onscroll={handleScroll}
    tabindex="-1"
  >
    {#if levelFilteredEntries.length === 0}
      <EmptyState variant="inline" title={entries.length === 0 ? "No log entries yet." : "No entries at this level."} />
    {:else}
      {#if hiddenEntryCount > 0}
        <p class="console-truncated">
          {hiddenEntryCount} older {hiddenEntryCount === 1 ? "entry" : "entries"} not shown
        </p>
      {/if}
      {#each visibleEntries as entry (entry.id)}
        <div class="console-line" data-level={entry.level}>
          {entry.text}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .console-logs-panel {
    min-height: 0;
    height: 100%;
    overflow: hidden;
  }

  .console-scroll {
    height: 100%;
    overflow: auto;
    padding: var(--space-4) var(--editor-content-padding-x, var(--space-8));
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    line-height: 1.45;
    user-select: text;
    -webkit-user-select: text;
  }

  .console-truncated {
    margin: 0 0 var(--space-4);
    color: var(--color-text-secondary);
  }

  .console-line {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .console-line[data-level="error"] {
    color: var(--color-danger);
  }

  .console-line[data-level="warn"] {
    color: color-mix(in srgb, var(--color-danger) 50%, var(--color-text-secondary));
  }

  .console-line[data-level="debug"],
  .console-line[data-level="trace"] {
    color: var(--color-text-secondary);
  }
</style>
