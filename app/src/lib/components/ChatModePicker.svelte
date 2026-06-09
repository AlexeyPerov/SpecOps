<script lang="ts">
  import type { ChatModeId } from "../domain/contracts";

  interface ModeOption {
    id: ChatModeId;
    name: string;
  }

  interface Props {
    availableModes: ModeOption[];
    activeMode: ChatModeId;
    disabled: boolean;
    onSelectMode: (modeId: ChatModeId) => void;
  }

  let { availableModes, activeMode, disabled, onSelectMode }: Props = $props();
</script>

<select
  class="chat-mode-select"
  aria-label="Select chat mode"
  value={activeMode}
  {disabled}
  onchange={(event) => {
    const next = (event.currentTarget as HTMLSelectElement).value as ChatModeId;
    onSelectMode(next);
  }}
>
  {#each availableModes as mode (mode.id)}
    <option value={mode.id}>{mode.name}</option>
  {/each}
</select>

<style>
  .chat-mode-select {
    min-height: 24px;
    min-width: 88px;
    max-width: 140px;
    padding: 0 var(--space-6);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font: inherit;
    font-size: 11px;
    line-height: 1;
  }

  .chat-mode-select:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .chat-mode-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @container (max-width: 520px) {
    .chat-mode-select {
      flex: 1;
      max-width: none;
    }
  }
</style>
