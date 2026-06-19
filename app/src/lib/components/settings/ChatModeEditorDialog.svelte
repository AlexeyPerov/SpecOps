<script lang="ts">
  import type { BuiltinChatModeId } from "../../domain/contracts";
  import type { ResolvedChatMode } from "../../ai/modes/resolve";
  import { appState } from "../../state/appState";
  import {
    addRequiredSection as addRequiredSectionToList,
    removeRequiredSection as removeRequiredSectionFromList,
    reorderRequiredSections,
    updateRequiredSection as updateRequiredSectionInList,
  } from "./settingsPanelActions";

  let {
    open = false,
    mode = null,
    builtinId = null,
    onClose = () => {},
    onDelete = () => {},
  }: {
    open?: boolean;
    mode?: ResolvedChatMode | null;
    builtinId?: BuiltinChatModeId | null;
    onClose?: () => void;
    onDelete?: () => void;
  } = $props();

  const snapshot = $derived($appState);
  const isBuiltin = $derived(mode?.source === "builtin");
  const customMode = $derived(
    !isBuiltin && mode
      ? (snapshot.settings.chatModes.customModes.find((entry) => entry.id === mode.id) ?? null)
      : null,
  );

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  function moveRequiredSection(sectionIndex: number, offset: -1 | 1): void {
    const current = customMode;
    if (!current) {
      return;
    }
    const reordered = reorderRequiredSections(current.requiredSections, sectionIndex, offset);
    if (!reordered) {
      return;
    }
    appState.updateCustomChatMode(current.id, { requiredSections: reordered });
  }

  function addRequiredSection(): void {
    const current = customMode;
    if (!current) {
      return;
    }
    appState.updateCustomChatMode(current.id, {
      requiredSections: addRequiredSectionToList(current.requiredSections),
    });
  }

  function updateRequiredSection(sectionIndex: number, value: string): void {
    const current = customMode;
    if (!current) {
      return;
    }
    appState.updateCustomChatMode(current.id, {
      requiredSections: updateRequiredSectionInList(current.requiredSections, sectionIndex, value),
    });
  }

  function removeRequiredSection(sectionIndex: number): void {
    const current = customMode;
    if (!current) {
      return;
    }
    appState.updateCustomChatMode(current.id, {
      requiredSections: removeRequiredSectionFromList(current.requiredSections, sectionIndex),
    });
  }
</script>

{#if open && mode}
  <div
    class="chat-mode-editor-backdrop"
    role="presentation"
    onpointerdown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}
  >
    <div
      class="chat-mode-editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-mode-editor-title"
      tabindex="-1"
      onkeydown={handleDialogKeydown}
      onpointerdown={(event) => event.stopPropagation()}
    >
      <header class="chat-mode-editor-header">
        <h3 id="chat-mode-editor-title">{mode.name}</h3>
        <button type="button" class="chat-mode-editor-close" aria-label="Close" onclick={onClose}>
          ×
        </button>
      </header>

      <div class="chat-mode-editor-body">
        {#if isBuiltin && builtinId}
          {#if builtinId === "raw"}
            <label class="settings-toggle">
              <input
                type="checkbox"
                checked={snapshot.settings.chatModes.rawEnabled}
                onchange={(event) =>
                  appState.setRawEnabled((event.currentTarget as HTMLInputElement).checked)}
              />
              Enabled
            </label>
          {/if}
          <p class="settings-section-note">
            Built-in prompts are read-only. Toggle workspace and summary context per mode.
          </p>
          <label class="settings-toggle">
            <input
              type="checkbox"
              checked={snapshot.settings.chatModes.builtinToggles[builtinId].includeWorkspace}
              onchange={(event) =>
                appState.updateBuiltinModeToggles(builtinId, {
                  includeWorkspace: (event.currentTarget as HTMLInputElement).checked,
                })}
            />
            Include workspace context
          </label>
          <label class="settings-toggle">
            <input
              type="checkbox"
              checked={snapshot.settings.chatModes.builtinToggles[builtinId].includeSummary}
              onchange={(event) =>
                appState.updateBuiltinModeToggles(builtinId, {
                  includeSummary: (event.currentTarget as HTMLInputElement).checked,
                })}
            />
            Include conversation summary
          </label>
          <label class="settings-field">
            <span>Prompt</span>
            <textarea rows={Math.max(3, mode.promptTemplate.split("\n").length + 1)} readonly
              >{mode.promptTemplate}</textarea
            >
          </label>
          {#if mode.requiredSections.length > 0}
            <p class="settings-section-note">
              Required sections: {mode.requiredSections.join(", ")}
            </p>
          {/if}
        {:else if customMode}
          {@const current = customMode}
          <label class="settings-toggle">
            <input
              type="checkbox"
              checked={current.enabled}
              onchange={(event) =>
                appState.updateCustomChatMode(current.id, {
                  enabled: (event.currentTarget as HTMLInputElement).checked,
                })}
            />
            Enabled
          </label>
          <label class="settings-field">
            <span>Name</span>
            <input
              type="text"
              value={current.name}
              onchange={(event) =>
                appState.updateCustomChatMode(current.id, {
                  name: (event.currentTarget as HTMLInputElement).value,
                })}
            />
          </label>
          <label class="settings-field">
            <span>Prompt</span>
            <textarea
              rows={Math.max(4, current.prompt.split("\n").length + 1)}
              spellcheck="false"
              placeholder={"You can use {{workspace}} and {{summary}} placeholders."}
              value={current.prompt}
              onchange={(event) =>
                appState.updateCustomChatMode(current.id, {
                  prompt: (event.currentTarget as HTMLTextAreaElement).value,
                })}
            ></textarea>
          </label>
          <label class="settings-toggle">
            <input
              type="checkbox"
              checked={current.includeWorkspace}
              onchange={(event) =>
                appState.updateCustomChatMode(current.id, {
                  includeWorkspace: (event.currentTarget as HTMLInputElement).checked,
                })}
            />
            Include workspace context
          </label>
          <label class="settings-toggle">
            <input
              type="checkbox"
              checked={current.includeSummary}
              onchange={(event) =>
                appState.updateCustomChatMode(current.id, {
                  includeSummary: (event.currentTarget as HTMLInputElement).checked,
                })}
            />
            Include conversation summary
          </label>

          <div class="settings-subsection">
            <h4>Required sections</h4>
            <button type="button" class="settings-action" onclick={addRequiredSection}>Add section</button>
            {#if current.requiredSections.length === 0}
              <p class="settings-section-note">
                No required sections. Responses are rendered as conversational markdown.
              </p>
            {:else}
              <div class="connection-list">
                {#each current.requiredSections as section, sectionIndex (`${current.id}-${sectionIndex}`)}
                  <div class="connection-row">
                    <input
                      class="required-section-input"
                      type="text"
                      value={section}
                      onchange={(event) =>
                        updateRequiredSection(
                          sectionIndex,
                          (event.currentTarget as HTMLInputElement).value,
                        )}
                    />
                    <div class="required-section-actions">
                      <button
                        type="button"
                        class="settings-action"
                        disabled={sectionIndex === 0}
                        onclick={() => moveRequiredSection(sectionIndex, -1)}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        class="settings-action"
                        disabled={sectionIndex === current.requiredSections.length - 1}
                        onclick={() => moveRequiredSection(sectionIndex, 1)}
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        class="settings-action settings-action-danger"
                        onclick={() => removeRequiredSection(sectionIndex)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <div class="settings-subsection">
            <h4>Section guidance (optional)</h4>
            <label class="settings-field">
              <span>Guidance</span>
              <textarea
                rows="3"
                spellcheck="false"
                placeholder="Extra instructions for how sections should be written."
                value={current.sectionGuidance ?? ""}
                onchange={(event) =>
                  appState.updateCustomChatMode(current.id, {
                    sectionGuidance: (event.currentTarget as HTMLTextAreaElement).value,
                  })}
              ></textarea>
            </label>
          </div>
        {/if}
      </div>

      <footer class="chat-mode-editor-footer">
        {#if !isBuiltin}
          <button
            type="button"
            class="settings-action settings-action-danger"
            onclick={onDelete}
          >
            Delete mode
          </button>
        {/if}
        <button type="button" class="settings-action" onclick={onClose}>Done</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .chat-mode-editor-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1310;
    display: grid;
    place-items: center;
    padding: var(--space-12);
    background: color-mix(in srgb, var(--color-surface-overlay) 85%, transparent);
  }

  .chat-mode-editor {
    display: flex;
    flex-direction: column;
    width: min(480px, calc(100vw - 2 * var(--space-12)));
    max-height: min(80vh, 640px);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    overflow: hidden;
  }

  .chat-mode-editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    padding: var(--space-8) var(--space-10);
    border-bottom: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
  }

  .chat-mode-editor-header h3 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .chat-mode-editor-close {
    width: 28px;
    height: 28px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .chat-mode-editor-close:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
  }

  .chat-mode-editor-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-8) var(--space-10);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .chat-mode-editor-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-8) var(--space-10);
    border-top: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
  }

  .chat-mode-editor-footer .settings-action-danger {
    margin-right: auto;
  }
</style>
