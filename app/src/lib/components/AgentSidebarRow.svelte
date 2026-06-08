<script lang="ts">
  import type { AgentIndexEntry } from "../domain/contracts";
  import { formatSidebarListTitle } from "../services/chatAgents";
  import { chatAgentSubtitleById } from "../state/chatStore";

  interface Props {
    agent: AgentIndexEntry;
    selected?: boolean;
    onSelect?: (agentId: string) => void;
    onContextMenu?: (event: MouseEvent, agentId: string) => void;
  }

  let {
    agent,
    selected = false,
    onSelect = () => {},
    onContextMenu = () => {},
  }: Props = $props();

  const subtitleById = $derived($chatAgentSubtitleById);
  const subtitle = $derived(subtitleById.get(agent.id) ?? null);
</script>

<button
  class={`agents-row ${selected ? "agents-row-selected" : ""}`}
  type="button"
  title={agent.title}
  onclick={() => onSelect(agent.id)}
  oncontextmenu={(event) => onContextMenu(event, agent.id)}
>
  <span class="agents-row-title">{formatSidebarListTitle(agent.title)}</span>
  {#if subtitle}
    <span class="agents-row-subtitle" title={subtitle.full}>{subtitle.display}</span>
  {/if}
</button>

<style>
  .agents-row {
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

  .agents-row:hover {
    background: var(--color-hover);
    cursor: pointer;
  }

  .agents-row-selected {
    background: var(--color-selection);
    border-color: var(--color-border-subtle);
  }

  .agents-row-title {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agents-row-subtitle {
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
