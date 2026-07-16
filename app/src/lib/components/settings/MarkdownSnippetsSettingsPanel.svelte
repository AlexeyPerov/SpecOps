<script lang="ts">
  /**
   * Editor → Markdown snippets settings (M6.2).
   * Enable/disable built-ins; add/edit/duplicate/remove user snippets with
   * local draft validation so invalid edits never corrupt persisted settings.
   */
  import type { BuiltinSnippetId, UserSnippetRecord } from "../../domain/contracts";
  import { isBuiltinSnippetId } from "../../editor/markdownSnippetCatalog";
  import {
    collectTakenTriggers,
    collectTakenUserIds,
    createUserSnippetId,
    listAllMarkdownSnippets,
    validateUserSnippetDraft,
    type SnippetFieldError,
  } from "../../editor/markdownSnippetSettings";
  import { requestConfirm } from "../../services/confirmDialogUi";
  import { appState } from "../../state/appState";

  const snapshot = $derived($appState);
  const allSnippets = $derived(listAllMarkdownSnippets(snapshot.settings.markdownSnippets));

  let selectedId = $state<string | null>(null);
  let draft = $state<UserSnippetRecord | null>(null);
  let fieldErrors = $state<SnippetFieldError[]>([]);
  let saveMessage = $state<string | null>(null);

  const selected = $derived(
    selectedId ? (allSnippets.find((entry) => entry.id === selectedId) ?? null) : null,
  );
  const isBuiltinSelected = $derived(selected?.source === "builtin");
  const isUserSelected = $derived(selected?.source === "user");

  $effect(() => {
    // Keep selection valid when the list shrinks.
    if (selectedId && !allSnippets.some((entry) => entry.id === selectedId)) {
      selectedId = null;
      draft = null;
      fieldErrors = [];
    }
  });

  function selectSnippet(id: string): void {
    selectedId = id;
    saveMessage = null;
    fieldErrors = [];
    const entry = allSnippets.find((item) => item.id === id);
    if (entry?.source === "user") {
      const stored = snapshot.settings.markdownSnippets.userSnippets.find(
        (item) => item.id === id,
      );
      draft = stored
        ? { ...stored }
        : {
            id: entry.id,
            name: entry.name,
            description: entry.description,
            trigger: entry.trigger,
            body: entry.body,
            enabled: entry.enabled,
          };
    } else {
      draft = null;
    }
  }

  function toggleBuiltin(id: BuiltinSnippetId, enabled: boolean): void {
    appState.setBuiltinSnippetEnabled(id, enabled);
  }

  function addUserSnippet(): void {
    const id = appState.createUserSnippetDraft();
    selectSnippet(id);
  }

  function duplicateSelected(): void {
    if (!selected || selected.source !== "user") {
      return;
    }
    const id = appState.duplicateUserSnippet(selected.id);
    if (id) {
      selectSnippet(id);
    }
  }

  async function removeSelected(): Promise<void> {
    if (!selected || selected.source !== "user") {
      return;
    }
    const confirmed = await requestConfirm({
      title: "Delete snippet",
      message: `Delete “${selected.name}”? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    appState.removeUserSnippet(selected.id);
    selectedId = null;
    draft = null;
    fieldErrors = [];
  }

  function updateDraft<K extends keyof UserSnippetRecord>(
    key: K,
    value: UserSnippetRecord[K],
  ): void {
    if (!draft) {
      return;
    }
    draft = { ...draft, [key]: value };
    saveMessage = null;
    fieldErrors = [];
  }

  function saveDraft(): void {
    const current = draft;
    if (!current) {
      return;
    }
    const settings = snapshot.settings.markdownSnippets;
    const errors = validateUserSnippetDraft(current, {
      takenTriggers: collectTakenTriggers(settings, current.id),
      takenIds: collectTakenUserIds(settings, current.id),
      currentId: current.id,
    });
    fieldErrors = errors;
    if (errors.length > 0) {
      saveMessage = null;
      return;
    }
    const existing = settings.userSnippets.some((entry) => entry.id === current.id);
    if (existing) {
      appState.updateUserSnippet(current.id, { ...current });
    } else {
      appState.addUserSnippet({ ...current, id: current.id || createUserSnippetId() });
    }
    saveMessage = "Saved.";
    selectedId = current.id;
  }

  function errorFor(field: SnippetFieldError["field"]): string | null {
    return fieldErrors.find((entry) => entry.field === field)?.message ?? null;
  }
</script>

<section class="settings-section">
  <h3>Markdown snippets</h3>
  <p class="settings-section-note">
    Reusable Markdown templates with tab stops. Use
    <code>$&#123;1:default&#125;</code>, <code>$&#123;0&#125;</code> for the final cursor, and
    <code>$&#123;SELECTION&#125;</code> to wrap the current selection. Built-ins can be disabled
    but not edited.
  </p>

  <div class="snippet-settings" aria-label="Markdown snippets">
    <div class="snippet-settings-list" role="listbox" aria-label="Snippet list">
      {#each allSnippets as entry (entry.id)}
        <button
          type="button"
          role="option"
          class="snippet-settings-row"
          class:snippet-settings-row-active={entry.id === selectedId}
          class:snippet-settings-row-disabled={!entry.enabled}
          aria-selected={entry.id === selectedId}
          onclick={() => selectSnippet(entry.id)}
        >
          <span class="snippet-settings-row-name">{entry.name}</span>
          <span class="snippet-settings-row-meta">
            {entry.trigger}
            · {entry.source === "builtin" ? "Built-in" : "Custom"}
            {#if !entry.enabled}
              · Off
            {/if}
          </span>
        </button>
      {/each}
      <button
        type="button"
        class="snippet-settings-add"
        aria-label="Add custom snippet"
        onclick={addUserSnippet}
      >
        + Add snippet
      </button>
    </div>

    <div class="snippet-settings-detail" aria-live="polite">
      {#if !selected}
        <p class="settings-section-note">Select a snippet to view or edit it.</p>
      {:else if isBuiltinSelected && selected}
        {@const builtinId = selected.id as BuiltinSnippetId}
        <h4 class="snippet-settings-detail-title">{selected.name}</h4>
        <p class="settings-section-note">{selected.description}</p>
        <label class="settings-toggle">
          <input
            type="checkbox"
            checked={selected.enabled}
            onchange={(event) => {
              if (isBuiltinSnippetId(builtinId)) {
                toggleBuiltin(builtinId, (event.currentTarget as HTMLInputElement).checked);
              }
            }}
          />
          Enabled
        </label>
        <label class="settings-field">
          <span>Trigger</span>
          <input type="text" value={selected.trigger} readonly />
        </label>
        <label class="settings-field">
          <span>Template</span>
          <textarea rows={10} readonly>{selected.body}</textarea>
        </label>
        <p class="settings-section-note">Built-in snippets cannot be overwritten or deleted.</p>
      {:else if isUserSelected && draft}
        <h4 class="snippet-settings-detail-title">Edit snippet</h4>
        <label class="settings-toggle">
          <input
            type="checkbox"
            checked={draft.enabled}
            onchange={(event) =>
              updateDraft("enabled", (event.currentTarget as HTMLInputElement).checked)}
          />
          Enabled
        </label>
        <label class="settings-field">
          <span>Name</span>
          <input
            type="text"
            value={draft.name}
            aria-invalid={errorFor("name") ? "true" : undefined}
            oninput={(event) =>
              updateDraft("name", (event.currentTarget as HTMLInputElement).value)}
          />
          {#if errorFor("name")}
            <span class="snippet-settings-error">{errorFor("name")}</span>
          {/if}
        </label>
        <label class="settings-field">
          <span>Description</span>
          <input
            type="text"
            value={draft.description}
            aria-invalid={errorFor("description") ? "true" : undefined}
            oninput={(event) =>
              updateDraft("description", (event.currentTarget as HTMLInputElement).value)}
          />
          {#if errorFor("description")}
            <span class="snippet-settings-error">{errorFor("description")}</span>
          {/if}
        </label>
        <label class="settings-field">
          <span>Trigger</span>
          <input
            type="text"
            value={draft.trigger}
            aria-invalid={errorFor("trigger") ? "true" : undefined}
            oninput={(event) =>
              updateDraft("trigger", (event.currentTarget as HTMLInputElement).value)}
          />
          {#if errorFor("trigger")}
            <span class="snippet-settings-error">{errorFor("trigger")}</span>
          {/if}
        </label>
        <label class="settings-field">
          <span>Template</span>
          <textarea
            rows={10}
            value={draft.body}
            aria-invalid={errorFor("body") ? "true" : undefined}
            oninput={(event) =>
              updateDraft("body", (event.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
          {#if errorFor("body")}
            <span class="snippet-settings-error">{errorFor("body")}</span>
          {/if}
        </label>
        <div class="snippet-settings-actions">
          <button type="button" class="btn btn-primary" onclick={saveDraft}>Save</button>
          <button type="button" class="btn btn-secondary" onclick={duplicateSelected}>
            Duplicate
          </button>
          <button type="button" class="btn btn-danger" onclick={() => void removeSelected()}>
            Delete
          </button>
          {#if saveMessage}
            <span class="snippet-settings-saved">{saveMessage}</span>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  .snippet-settings {
    display: grid;
    grid-template-columns: minmax(140px, 0.9fr) minmax(0, 1.4fr);
    gap: var(--space-6);
    margin-top: var(--space-4);
    min-height: 220px;
  }

  .snippet-settings-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    max-height: 360px;
    overflow: auto;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    padding: var(--space-2);
  }

  .snippet-settings-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    padding: var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .snippet-settings-row:hover {
    background: var(--color-hover);
  }

  .snippet-settings-row:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
  }

  .snippet-settings-row-active {
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface-1));
  }

  .snippet-settings-row-disabled {
    opacity: 0.6;
  }

  .snippet-settings-row-name {
    font-weight: 600;
    font-size: 0.8125rem;
  }

  .snippet-settings-row-meta {
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }

  .snippet-settings-add {
    margin-top: var(--space-2);
    padding: var(--space-4);
    border: 1px dashed var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    cursor: pointer;
  }

  .snippet-settings-add:hover {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }

  .snippet-settings-detail {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .snippet-settings-detail-title {
    margin: 0;
    font-size: 0.9375rem;
  }

  .snippet-settings-error {
    display: block;
    margin-top: 2px;
    font-size: var(--font-size-status);
    color: var(--color-danger);
  }

  .snippet-settings-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
  }

  .snippet-settings-saved {
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }

  @media (max-width: 720px) {
    .snippet-settings {
      grid-template-columns: 1fr;
    }
  }
</style>
