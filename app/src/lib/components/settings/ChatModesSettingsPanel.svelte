<script lang="ts">
  import type { BuiltinChatModeId } from "../../domain/contracts";
  import type { ResolvedChatMode } from "../../ai/modes/resolve";
  import { listBuiltinResolvedChatModes } from "../../ai/modes/resolve";
  import { isBuiltinChatModeId } from "../../ai/modes/chatModesSettings";
  import { appState } from "../../state/appState";
  import ChatModeEditorDialog from "./ChatModeEditorDialog.svelte";

  const BUILTIN_CHAT_MODE_ORDER: readonly BuiltinChatModeId[] = ["ask", "review", "raw"];

  const snapshot = $derived($appState);
  let editorOpen = $state(false);
  let editingMode = $state<ResolvedChatMode | null>(null);
  let editingBuiltinId = $state<BuiltinChatModeId | null>(null);

  function allModes(): ResolvedChatMode[] {
    const builtins = listBuiltinResolvedChatModes(snapshot.settings);
    const orderedBuiltins = BUILTIN_CHAT_MODE_ORDER.map((id) =>
      builtins.find((mode) => mode.id === id),
    ).filter((mode): mode is ResolvedChatMode => mode !== undefined);
    const customs = snapshot.settings.chatModes.customModes.map(
      (custom): ResolvedChatMode => ({
        id: custom.id,
        name: custom.name,
        source: "custom",
        editable: true,
        enabled: custom.enabled,
        promptTemplate: custom.prompt,
        includeWorkspace: custom.includeWorkspace,
        includeSummary: custom.includeSummary,
        requiredSections: custom.requiredSections,
        sectionGuidance: custom.sectionGuidance,
      }),
    );
    return [...orderedBuiltins, ...customs];
  }

  function openModeEditor(mode: ResolvedChatMode): void {
    editingMode = mode;
    editingBuiltinId = isBuiltinChatModeId(mode.id) ? mode.id : null;
    editorOpen = true;
  }

  function closeModeEditor(): void {
    editorOpen = false;
    editingMode = null;
    editingBuiltinId = null;
  }

  function addCustomMode(): void {
    const id = appState.createCustomChatModeDraft();
    const created = appState
      .getSnapshot()
      .settings.chatModes.customModes.find((mode) => mode.id === id);
    if (!created) {
      return;
    }
    openModeEditor({
      id: created.id,
      name: created.name,
      source: "custom",
      editable: true,
      enabled: created.enabled,
      promptTemplate: created.prompt,
      includeWorkspace: created.includeWorkspace,
      includeSummary: created.includeSummary,
      requiredSections: created.requiredSections,
      sectionGuidance: created.sectionGuidance,
    });
  }

  function deleteEditingMode(): void {
    if (!editingMode || editingMode.source !== "custom") {
      return;
    }
    appState.removeCustomChatMode(editingMode.id);
    closeModeEditor();
  }
</script>

<section class="settings-section">
  <h3>Chat modes</h3>
  <p class="settings-section-note">
    Click a mode to edit. Use <code>{"{{workspace}}"}</code> and <code>{"{{summary}}"}</code>
    placeholders in custom prompts.
  </p>

  <div class="chat-modes-grid" aria-label="Chat modes">
    {#each allModes() as mode (mode.id)}
      <button
        type="button"
        class="chat-mode-tile"
        class:chat-mode-tile-disabled={!mode.enabled}
        aria-label={`Edit ${mode.name}`}
        onclick={() => openModeEditor(mode)}
      >
        <span class="chat-mode-tile-title">{mode.name}</span>
        {#if mode.source === "custom" && !mode.enabled}
          <span class="chat-mode-tile-badge">Disabled</span>
        {/if}
      </button>
    {/each}
    <button
      type="button"
      class="chat-mode-tile chat-mode-tile-add"
      aria-label="Add custom mode"
      onclick={addCustomMode}
    >
      <span class="chat-mode-tile-add-icon" aria-hidden="true">+</span>
    </button>
  </div>
</section>

<ChatModeEditorDialog
  open={editorOpen}
  mode={editingMode}
  builtinId={editingBuiltinId}
  onClose={closeModeEditor}
  onDelete={deleteEditingMode}
/>

<style>
  .chat-modes-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: var(--space-6);
    margin-top: var(--space-4);
  }

  .chat-mode-tile {
    aspect-ratio: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font: inherit;
    cursor: pointer;
    text-align: center;
    transition:
      border-color 120ms ease,
      background 120ms ease;
  }

  .chat-mode-tile:hover {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-1));
  }

  .chat-mode-tile:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  .chat-mode-tile-disabled {
    opacity: 0.55;
  }

  .chat-mode-tile-title {
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.3;
    word-break: break-word;
  }

  .chat-mode-tile-badge {
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .chat-mode-tile-add {
    border-style: dashed;
    color: var(--color-text-secondary);
  }

  .chat-mode-tile-add:hover {
    color: var(--color-text-primary);
  }

  .chat-mode-tile-add-icon {
    font-size: 1.75rem;
    font-weight: 300;
    line-height: 1;
  }
</style>
