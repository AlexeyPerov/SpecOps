<script lang="ts">
  import Select from "./Select.svelte";
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

  const selectOptions = $derived(
    availableModes.map((mode) => ({ value: mode.id, label: mode.name })),
  );
</script>

<div class="chat-mode-picker">
  <Select
    options={selectOptions}
    value={activeMode}
    {disabled}
    onchange={(value) => onSelectMode(value as ChatModeId)}
    ariaLabel="Select chat mode"
    class="chat-mode-select"
  />
</div>

<style>
  .chat-mode-picker {
    min-width: 0;
  }

  :global(.chat-mode-select) {
    min-width: 88px;
    max-width: 140px;
  }

  :global(.chat-mode-select .select-trigger) {
    font-size: 11px;
  }

  @container (max-width: 520px) {
    :global(.chat-mode-select) {
      flex: 1;
      max-width: none;
    }
  }
</style>
