<script lang="ts">
  import type { AgentIndexEntry } from "../domain/contracts";

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
</script>

<button
  class={`agents-row ${selected ? "agents-row-selected" : ""}`}
  type="button"
  title={agent.title}
  onclick={() => onSelect(agent.id)}
  oncontextmenu={(event) => onContextMenu(event, agent.id)}
>
  <span class="agents-row-title">{agent.title}</span>
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
