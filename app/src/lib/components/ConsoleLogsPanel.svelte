<script lang="ts">
  import { consoleLogs } from "../services/appConsole";

  const DISPLAY_MAX_ENTRIES = 250;

  let scrollEl = $state<HTMLDivElement | undefined>(undefined);
  let entries = $derived($consoleLogs);
  let hiddenEntryCount = $derived(Math.max(0, entries.length - DISPLAY_MAX_ENTRIES));
  let visibleEntries = $derived(
    entries.length > DISPLAY_MAX_ENTRIES ? entries.slice(entries.length - DISPLAY_MAX_ENTRIES) : entries
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
