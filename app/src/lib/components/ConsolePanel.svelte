<script lang="ts">
  import { afterUpdate, onDestroy } from "svelte";
  import { consoleLogs, type ConsoleLogEntry } from "../services/appConsole";

  const DISPLAY_MAX_ENTRIES = 250;

  let scrollEl: HTMLDivElement | undefined;
  let entries: ConsoleLogEntry[] = [];
  let visibleEntries: ConsoleLogEntry[] = [];
  let hiddenEntryCount = 0;
  let stickToBottom = true;

  const unsubscribe = consoleLogs.subscribe((value) => {
    entries = value;
    hiddenEntryCount = Math.max(0, value.length - DISPLAY_MAX_ENTRIES);
    visibleEntries =
      value.length > DISPLAY_MAX_ENTRIES ? value.slice(value.length - DISPLAY_MAX_ENTRIES) : value;
  });

  onDestroy(unsubscribe);

  afterUpdate(() => {
    if (stickToBottom && scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  });

  function handleScroll(): void {
    if (!scrollEl) {
      return;
    }
    const distanceFromBottom =
      scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    stickToBottom = distanceFromBottom < 24;
  }
</script>

<section class="console-panel" aria-hidden="false">
  <div
    class="console-scroll"
    bind:this={scrollEl}
    onscroll={handleScroll}
    tabindex="-1"
  >
    {#if entries.length === 0}
      <p class="console-empty">No log entries yet.</p>
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
</section>

<style>
  .console-panel {
    min-height: 0;
    height: var(--console-height);
    overflow: hidden;
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }

  .console-scroll {
    height: 100%;
    overflow: auto;
    padding: var(--space-4) var(--space-8);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    line-height: 1.45;
    user-select: text;
    -webkit-user-select: text;
  }

  .console-empty,
  .console-truncated {
    margin: 0 0 var(--space-4);
    color: var(--color-text-secondary);
  }

  .console-line {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .console-line[data-level="error"] {
    color: #e06c75;
  }

  .console-line[data-level="warn"] {
    color: #e5c07b;
  }

  .console-line[data-level="debug"],
  .console-line[data-level="trace"] {
    color: var(--color-text-secondary);
  }
</style>
