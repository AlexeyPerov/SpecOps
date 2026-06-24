<script lang="ts">
  import type { SessionIndexEntry } from "../domain/contracts";
  import { formatSidebarListTitle } from "../services/chatSessions";
  import { chatSessionSubtitleById } from "../state/chatStore";

  interface Props {
    session: SessionIndexEntry;
    selected?: boolean;
    onSelect?: (sessionId: string) => void;
    onContextMenu?: (event: MouseEvent, sessionId: string) => void;
  }

  let {
    session,
    selected = false,
    onSelect = () => {},
    onContextMenu = () => {},
  }: Props = $props();

  const subtitleById = $derived($chatSessionSubtitleById);
  const subtitle = $derived(subtitleById.get(session.id) ?? null);
</script>

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
</style>
