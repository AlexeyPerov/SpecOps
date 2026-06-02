<script lang="ts">
  import type { AppCommandId } from "../domain/contracts";
  import { commandDefinitions } from "../commands/registry";
  import {
    findKeymapConflict,
    formatBindingForDisplay,
    keyboardEventToBinding,
    listShortcutCommands,
    mergeCommandDefinitionsWithOverrides,
  } from "../commands/commandBindings";
  import { isMacOs } from "../services/platform";
  import { appState } from "../state/appState";

  const snapshot = $derived($appState);
  const platform = $derived(isMacOs() ? "mac" : "windows");
  const shortcutRows = $derived(
    listShortcutCommands(commandDefinitions, snapshot.settings.commandBindingOverrides),
  );

  let recordingCommandId = $state<AppCommandId | null>(null);
  let conflictMessage = $state<string | null>(null);

  function bindingLabel(commandId: AppCommandId): string {
    const row = shortcutRows.find((entry) => entry.id === commandId);
    if (!row) {
      return "None";
    }
    return formatBindingForDisplay(row.binding[platform]);
  }

  function startRecording(commandId: AppCommandId): void {
    recordingCommandId = commandId;
    conflictMessage = null;
  }

  function stopRecording(): void {
    recordingCommandId = null;
    conflictMessage = null;
  }

  function applyBinding(commandId: AppCommandId, binding: string): void {
    const merged = mergeCommandDefinitionsWithOverrides(
      commandDefinitions,
      snapshot.settings.commandBindingOverrides,
    );
    const conflict = findKeymapConflict(merged, commandId, binding, platform);
    if (conflict) {
      const conflictLabel =
        commandDefinitions.find((definition) => definition.id === conflict)?.label ?? conflict;
      conflictMessage = `Already assigned to “${conflictLabel}”.`;
      return;
    }
    appState.updateCommandBinding(commandId, { [platform]: binding });
    stopRecording();
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (!recordingCommandId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      stopRecording();
      return;
    }
    const binding = keyboardEventToBinding(event);
    if (!binding) {
      return;
    }
    applyBinding(recordingCommandId, binding);
  }

  $effect(() => {
    if (!recordingCommandId) {
      return;
    }
    window.addEventListener("keydown", handleWindowKeydown, true);
    return () => {
      window.removeEventListener("keydown", handleWindowKeydown, true);
    };
  });
</script>

<section class="settings-section shortcuts-section">
  <h3>Keyboard shortcuts</h3>
  <p class="settings-section-note">
    Click a shortcut, then press the new key combination. Press Escape to cancel. Changes apply
    immediately and are saved with your other settings.
  </p>
  {#if conflictMessage}
    <p class="shortcuts-conflict" role="alert">{conflictMessage}</p>
  {/if}
  <ul class="shortcuts-list">
    {#each shortcutRows as row (row.id)}
      <li class="shortcuts-row">
        <span class="shortcuts-label">{row.label}</span>
        <div class="shortcuts-actions">
          <button
            type="button"
            class="shortcuts-binding"
            class:shortcuts-binding-recording={recordingCommandId === row.id}
            aria-label={`Change shortcut for ${row.label}`}
            onclick={() =>
              recordingCommandId === row.id ? stopRecording() : startRecording(row.id)}
          >
            {#if recordingCommandId === row.id}
              Press keys…
            {:else}
              {bindingLabel(row.id)}
            {/if}
          </button>
          {#if row.isCustomized}
            <button
              type="button"
              class="shortcuts-reset"
              onclick={() => appState.resetCommandBinding(row.id)}
            >
              Reset
            </button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
</section>

<style>
  .shortcuts-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .shortcuts-conflict {
    margin: 0;
    font-size: 0.75rem;
    color: var(--color-danger, #c44);
  }

  .shortcuts-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .shortcuts-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    min-height: 32px;
  }

  .shortcuts-label {
    flex: 1;
    min-width: 0;
    font-size: 0.8125rem;
    color: var(--color-text-primary);
  }

  .shortcuts-actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-shrink: 0;
  }

  .shortcuts-binding {
    min-width: 120px;
    padding: var(--space-2) var(--space-6);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2, var(--color-surface-1));
    color: var(--color-text-primary);
    font: inherit;
    font-size: 0.75rem;
    text-align: center;
    cursor: pointer;
  }

  .shortcuts-binding:hover {
    border-color: var(--color-accent);
    background: var(--color-hover);
  }

  .shortcuts-binding:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .shortcuts-binding-recording {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 35%, transparent);
  }

  .shortcuts-reset {
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .shortcuts-reset:hover {
    color: var(--color-text-primary);
    background: var(--color-hover);
  }

  .shortcuts-reset:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }
</style>
