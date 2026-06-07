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

<div class="chat-mode-toolbar" role="group" aria-label="Chat mode">
  <span class="chat-mode-label">Mode</span>
  <div class="chat-mode-options" role="radiogroup" aria-label="Select chat mode">
    {#each availableModes as mode (mode.id)}
      <button
        type="button"
        role="radio"
        class="chat-mode-option"
        class:chat-mode-option-active={activeMode === mode.id}
        aria-checked={activeMode === mode.id}
        {disabled}
        onclick={() => onSelectMode(mode.id)}
      >
        {mode.name}
      </button>
    {/each}
  </div>
</div>

<style>
  .chat-mode-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-6);
  }

  .chat-mode-label {
    font-size: 11px;
    line-height: 1.4;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .chat-mode-options {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 2px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
  }

  .chat-mode-option {
    min-height: 22px;
    padding: 0 var(--space-6);
    border: 1px solid transparent;
    border-radius: calc(var(--radius-sm) - 1px);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 11px;
    line-height: 1;
  }

  .chat-mode-option:hover:not(:disabled) {
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .chat-mode-option:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .chat-mode-option-active {
    border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-accent) 14%, var(--color-surface-1));
    color: var(--color-text-primary);
  }

  .chat-mode-option:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @container (max-width: 520px) {
    .chat-mode-toolbar {
      flex: 1 1 100%;
    }
  }
</style>
