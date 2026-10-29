<script lang="ts">
  import type { SessionIndexEntry } from "../domain/contracts";
  import { formatSidebarListTitle } from "../services/chatSessions";
  import { chatSessionSubtitleById } from "../state/chatStore";

  interface Props {
    session: SessionIndexEntry;
    selected?: boolean;
    onSelect?: (sessionId: string) => void;
    onContextMenu?: (event: MouseEvent, sessionId: string) => void;
    /** Show the title as an inline editor. */
    renaming?: boolean;
    onRenameCommit?: (title: string) => void;
    onRenameCancel?: () => void;
  }

  let {
    session,
    selected = false,
    onSelect = () => {},
    onContextMenu = () => {},
    renaming = false,
    onRenameCommit = () => {},
    onRenameCancel = () => {},
  }: Props = $props();

  let renameValue = $state("");
  let finished = false;

  function focusRenameInput(node: HTMLInputElement): void {
    renameValue = session.title;
    finished = false;
    queueMicrotask(() => {
      node.focus();
      node.select();
    });
  }

  function finishRename(commit: boolean): void {
    if (finished) return;
    finished = true;
    const title = renameValue.trim();
    if (commit && title && title !== session.title.trim()) onRenameCommit(title);
    else onRenameCancel();
  }

  function handleRenameKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      finishRename(event.key === "Enter");
    }
  }

  const subtitleById = $derived($chatSessionSubtitleById);
  const subtitle = $derived(subtitleById.get(session.id) ?? null);
</script>

{#if renaming}
  <div class={`sessions-row sessions-row-renaming ${selected ? "sessions-row-selected" : ""}`}>
    <input
      class="sessions-row-rename-input"
      use:focusRenameInput
      bind:value={renameValue}
      aria-label="Session title"
      onkeydown={handleRenameKeydown}
      onblur={() => finishRename(true)}
    />
  </div>
{:else}
<button
  class={`sessions-row ${selected ? "sessions-row-selected" : ""}`}
  type="button"
  title={session.title}
  onclick={() => onSelect(session.id)}
  oncontextmenu={(event) => onContextMenu(event, session.id)}
>
  <span class="sessions-row-title">{formatSidebarListTitle(session.title)}</span>
  {#if subtitle}
    <span class="sessions-row-subtitle" title={subtitle.full}>{subtitle.display}</span>
  {/if}
</button>
{/if}

<style>
  .sessions-row {
    width: 100%;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    text-align: left;
    padding: var(--space-4) var(--space-6);
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: stretch;
  }

  .sessions-row:hover {
    background: var(--color-hover);
    cursor: pointer;
  }

  .sessions-row-selected {
    background: var(--color-selection);
    border-color: var(--color-border-subtle);
  }

  .sessions-row-title {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sessions-row-subtitle {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    line-height: 1.3;
    color: var(--color-text-secondary);
  }

  .sessions-row-renaming {
    padding-block: var(--space-2);
  }

  .sessions-row-rename-input {
    min-width: 0;
    height: 24px;
    border: 1px solid var(--color-focus-ring);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font: inherit;
    padding: 0 var(--space-3);
    outline: none;
  }
</style>
