<script lang="ts">
  import type { BuiltinChatModeId, CustomChatModeDefinition } from "../../domain/contracts";
  import { listBuiltinResolvedChatModes } from "../../ai/modes/resolve";
  import { appState } from "../../state/appState";
  import {
    addRequiredSection as addRequiredSectionToList,
    nextSelectedIdAfterRemoval,
    removeRequiredSection as removeRequiredSectionFromList,
    reorderRequiredSections,
    resolveSelectedListItem,
    resolveSelectedListItemId,
    updateRequiredSection as updateRequiredSectionInList,
  } from "./settingsPanelActions";

  const BUILTIN_CHAT_MODE_ORDER: readonly BuiltinChatModeId[] = ["ask", "review", "raw"];

  const snapshot = $derived($appState);
  let selectedCustomModeId = $state<string | null>(null);

  function builtinChatModes() {
    return listBuiltinResolvedChatModes(snapshot.settings);
  }

  function customModes() {
    return snapshot.settings.chatModes.customModes;
  }

  function selectedCustomMode(): CustomChatModeDefinition | null {
    return resolveSelectedListItem(selectedCustomModeId, customModes());
  }

  function addCustomMode(): void {
    const id = appState.createCustomChatModeDraft();
    selectedCustomModeId = id;
  }

  function removeCustomMode(modeId: string): void {
    appState.removeCustomChatMode(modeId);
    selectedCustomModeId = nextSelectedIdAfterRemoval(
      modeId,
      selectedCustomModeId,
      customModes().map((mode) => mode.id),
    );
  }

  function moveRequiredSection(sectionIndex: number, offset: -1 | 1): void {
    const mode = selectedCustomMode();
    if (!mode) {
      return;
    }
    const reordered = reorderRequiredSections(mode.requiredSections, sectionIndex, offset);
    if (!reordered) {
      return;
    }
    appState.updateCustomChatMode(mode.id, { requiredSections: reordered });
  }

  function addRequiredSection(): void {
    const mode = selectedCustomMode();
    if (!mode) {
      return;
    }
    appState.updateCustomChatMode(mode.id, {
      requiredSections: addRequiredSectionToList(mode.requiredSections),
    });
  }

  function updateRequiredSection(sectionIndex: number, value: string): void {
    const mode = selectedCustomMode();
    if (!mode) {
      return;
    }
    appState.updateCustomChatMode(mode.id, {
      requiredSections: updateRequiredSectionInList(mode.requiredSections, sectionIndex, value),
    });
  }

  function removeRequiredSection(sectionIndex: number): void {
    const mode = selectedCustomMode();
    if (!mode) {
      return;
    }
    appState.updateCustomChatMode(mode.id, {
      requiredSections: removeRequiredSectionFromList(mode.requiredSections, sectionIndex),
    });
  }

  $effect(() => {
    selectedCustomModeId = resolveSelectedListItemId(
      selectedCustomModeId,
      customModes().map((mode) => mode.id),
    );
  });
</script>

<section class="settings-section">
  <h3>Built-in modes</h3>
  <p class="settings-section-note">
    Built-in prompts are read-only. Toggle workspace and summary context per mode.
  </p>
  {#each BUILTIN_CHAT_MODE_ORDER as builtinId (builtinId)}
    {@const mode = builtinChatModes().find((entry) => entry.id === builtinId)}
    {#if mode}
      <div class="settings-subsection settings-subsection-separated">
        <h4>{mode.name}</h4>
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
      </div>
    {/if}
  {/each}
</section>

<section class="settings-section">
  <h3>Custom modes</h3>
  <p class="settings-section-note">
    Use <code>{"{{workspace}}"}</code> and <code>{"{{summary}}"}</code> placeholders in prompts.
  </p>
  <div class="settings-subsection">
    <h4>Mode list</h4>
    <button type="button" class="settings-action" onclick={addCustomMode}>Add mode</button>
    {#if customModes().length === 0}
      <p class="settings-section-note">No custom modes yet. Add one to start.</p>
    {:else}
      <div class="connection-list" role="listbox" aria-label="Custom chat modes">
        {#each customModes() as mode (mode.id)}
          <div
            class="connection-row"
            class:connection-row-active={mode.id === selectedCustomMode()?.id}
            role="option"
            aria-selected={mode.id === selectedCustomMode()?.id}
          >
            <button
              type="button"
              class="connection-row-select"
              onclick={() => {
                selectedCustomModeId = mode.id;
              }}
            >
              <span>{mode.name}</span>
              <small>{mode.enabled ? "Enabled" : "Disabled"}</small>
            </button>
            <button
              type="button"
              class="connection-row-remove settings-action settings-action-danger"
              aria-label={`Remove ${mode.name}`}
              onclick={() => removeCustomMode(mode.id)}
            >
              Remove
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
  {#if selectedCustomMode()}
    {@const mode = selectedCustomMode()!}
    <div class="settings-subsection settings-subsection-separated">
      <h4>Editor</h4>
      <label class="settings-toggle">
        <input
          type="checkbox"
          checked={mode.enabled}
          onchange={(event) =>
            appState.updateCustomChatMode(mode.id, {
              enabled: (event.currentTarget as HTMLInputElement).checked,
            })}
        />
        Enabled
      </label>
      <label class="settings-field">
        <span>Name</span>
        <input
          type="text"
          value={mode.name}
          onchange={(event) =>
            appState.updateCustomChatMode(mode.id, {
              name: (event.currentTarget as HTMLInputElement).value,
            })}
        />
      </label>
      <label class="settings-field">
        <span>Prompt</span>
        <textarea
          rows={Math.max(4, mode.prompt.split("\n").length + 1)}
          spellcheck="false"
          placeholder={"You can use {{workspace}} and {{summary}} placeholders."}
          value={mode.prompt}
          onchange={(event) =>
            appState.updateCustomChatMode(mode.id, {
              prompt: (event.currentTarget as HTMLTextAreaElement).value,
            })}
        ></textarea>
      </label>
      <label class="settings-toggle">
        <input
          type="checkbox"
          checked={mode.includeWorkspace}
          onchange={(event) =>
            appState.updateCustomChatMode(mode.id, {
              includeWorkspace: (event.currentTarget as HTMLInputElement).checked,
            })}
        />
        Include workspace context
      </label>
      <label class="settings-toggle">
        <input
          type="checkbox"
          checked={mode.includeSummary}
          onchange={(event) =>
            appState.updateCustomChatMode(mode.id, {
              includeSummary: (event.currentTarget as HTMLInputElement).checked,
            })}
        />
        Include conversation summary
      </label>
    </div>
    <div class="settings-subsection">
      <h4>Required sections</h4>
      <button type="button" class="settings-action" onclick={addRequiredSection}>Add section</button>
      {#if mode.requiredSections.length === 0}
        <p class="settings-section-note">
          No required sections. Responses are rendered as conversational markdown.
        </p>
      {:else}
        <div class="connection-list">
          {#each mode.requiredSections as section, sectionIndex (`${mode.id}-${sectionIndex}`)}
            <div class="connection-row">
              <input
                class="required-section-input"
                type="text"
                value={section}
                onchange={(event) =>
                  updateRequiredSection(sectionIndex, (event.currentTarget as HTMLInputElement).value)}
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
                  disabled={sectionIndex === mode.requiredSections.length - 1}
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
          value={mode.sectionGuidance ?? ""}
          onchange={(event) =>
            appState.updateCustomChatMode(mode.id, {
              sectionGuidance: (event.currentTarget as HTMLTextAreaElement).value,
            })}
        ></textarea>
      </label>
    </div>
  {/if}
</section>

<style>
  @import "../../styles/settingsForm.css";
  @import "../../styles/settingsFormMultiline.css";
  @import "../../styles/settingsDialogForm.css";
  @import "../../styles/settingsPanelLists.css";
</style>
