<script lang="ts">
  import type { OpencodeAgentConfigEntry } from "../../ai/backends/workspaceAgentBackend";

  let {
    open = false,
    /** Existing agent name when editing; null when creating. */
    name = null,
    /** Initial entry values (copy-on-edit). */
    entry = null,
    onSave = (_name: string, _entry: OpencodeAgentConfigEntry) => {},
    onClose = () => {},
    onDelete = (_name: string) => {},
    /** Built-in agents can be viewed but not saved/deleted. */
    readonly = false,
  }: {
    open?: boolean;
    name?: string | null;
    entry?: OpencodeAgentConfigEntry | null;
    onSave?: (name: string, entry: OpencodeAgentConfigEntry) => void;
    onClose?: () => void;
    onDelete?: (name: string) => void;
    readonly?: boolean;
  } = $props();

  let draftName = $state("");
  let draftModel = $state("");
  let draftMode = $state<"subagent" | "primary" | "all">("all");
  let draftDescription = $state("");
  let draftPrompt = $state("");
  let draftSteps = $state("");
  let draftTemperature = $state("");
  let draftTopP = $state("");
  let error = $state<string | null>(null);

  // Re-seed the draft whenever the dialog opens or the target changes.
  $effect(() => {
    if (open) {
      draftName = name ?? "";
      draftModel = entry?.model ?? "";
      draftMode = entry?.mode ?? "all";
      draftDescription = entry?.description ?? "";
      draftPrompt = entry?.prompt ?? "";
      draftSteps = entry?.steps !== undefined ? String(entry.steps) : "";
      draftTemperature = entry?.temperature !== undefined ? String(entry.temperature) : "";
      draftTopP = entry?.topP !== undefined ? String(entry.topP) : "";
      error = null;
    }
  });

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  function parseNumber(raw: string): number | undefined {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function handleSave(): void {
    const trimmedName = draftName.trim();
    if (trimmedName.length === 0) {
      error = "Name is required.";
      return;
    }
    const entry: OpencodeAgentConfigEntry = {};
    if (draftModel.trim().length > 0) {
      entry.model = draftModel.trim();
    }
    entry.mode = draftMode;
    if (draftDescription.trim().length > 0) {
      entry.description = draftDescription.trim();
    }
    if (draftPrompt.trim().length > 0) {
      entry.prompt = draftPrompt.trim();
    }
    const steps = parseNumber(draftSteps);
    if (steps !== undefined) {
      entry.steps = steps;
    }
    const temperature = parseNumber(draftTemperature);
    if (temperature !== undefined) {
      entry.temperature = temperature;
    }
    const topP = parseNumber(draftTopP);
    if (topP !== undefined) {
      entry.topP = topP;
    }
    error = null;
    onSave(trimmedName, entry);
  }
</script>

{#if open}
  <div
    class="agent-editor-backdrop"
    role="presentation"
    onpointerdown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}
  >
    <div
      class="agent-editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-editor-title"
      tabindex="-1"
      onkeydown={handleDialogKeydown}
      onpointerdown={(event) => event.stopPropagation()}
    >
      <header class="agent-editor-header">
        <h3 id="agent-editor-title">{readonly ? draftName || "Agent" : name ? "Edit agent" : "New agent"}</h3>
        <button type="button" class="agent-editor-close" aria-label="Close" onclick={onClose}>
          ×
        </button>
      </header>

      <div class="agent-editor-body">
        {#if readonly}
          <p class="settings-section-note">
            Built-in agents are read-only. Edit a copy by creating a custom agent.
          </p>
        {/if}
        <label class="settings-field">
          <span>Name</span>
          <input
            type="text"
            spellcheck="false"
            placeholder="my-agent"
            value={draftName}
            disabled={readonly}
            oninput={(event) => (draftName = (event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="settings-field">
          <span>Model (provider/model)</span>
          <input
            type="text"
            spellcheck="false"
            placeholder="inherits default"
            value={draftModel}
            disabled={readonly}
            oninput={(event) => (draftModel = (event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="settings-field">
          <span>Mode</span>
          <select
            value={draftMode}
            disabled={readonly}
            onchange={(event) =>
              (draftMode = (event.currentTarget as HTMLSelectElement).value as typeof draftMode)}
          >
            <option value="all">All</option>
            <option value="primary">Primary</option>
            <option value="subagent">Subagent</option>
          </select>
        </label>
        <label class="settings-field">
          <span>Description</span>
          <input
            type="text"
            spellcheck="false"
            value={draftDescription}
            disabled={readonly}
            oninput={(event) => (draftDescription = (event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="settings-field">
          <span>Prompt (markdown)</span>
          <textarea
            rows="8"
            spellcheck="false"
            value={draftPrompt}
            disabled={readonly}
            oninput={(event) => (draftPrompt = (event.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
        </label>
        <div class="agent-editor-row">
          <label class="settings-field">
            <span>Steps limit</span>
            <input
              type="number"
              min="0"
              placeholder="unset"
              value={draftSteps}
              disabled={readonly}
              oninput={(event) => (draftSteps = (event.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <label class="settings-field">
            <span>Temperature</span>
            <input
              type="number"
              step="0.1"
              min="0"
              placeholder="unset"
              value={draftTemperature}
              disabled={readonly}
              oninput={(event) => (draftTemperature = (event.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <label class="settings-field">
            <span>Top P</span>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              placeholder="unset"
              value={draftTopP}
              disabled={readonly}
              oninput={(event) => (draftTopP = (event.currentTarget as HTMLInputElement).value)}
            />
          </label>
        </div>
        {#if error}<p class="settings-section-note agent-editor-error">{error}</p>{/if}
      </div>

      <footer class="agent-editor-footer">
        {#if !readonly && name}
          <button
            type="button"
            class="settings-action settings-action-danger"
            onclick={() => onDelete(name)}
          >
            Delete agent
          </button>
        {/if}
        <button type="button" class="settings-action" onclick={onClose}>Cancel</button>
        {#if !readonly}
          <button type="button" class="settings-action" onclick={handleSave}>Save</button>
        {/if}
      </footer>
    </div>
  </div>
{/if}

<style>
  .agent-editor-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1320;
    display: grid;
    place-items: center;
    padding: var(--space-12);
    background: color-mix(in srgb, var(--color-surface-overlay) 85%, transparent);
  }

  .agent-editor {
    display: flex;
    flex-direction: column;
    width: min(560px, calc(100vw - 2 * var(--space-12)));
    max-height: min(85vh, 720px);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    overflow: hidden;
  }

  .agent-editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    padding: var(--space-8) var(--space-10);
    border-bottom: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
  }

  .agent-editor-header h3 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .agent-editor-close {
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

  .agent-editor-close:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
  }

  .agent-editor-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-8) var(--space-10);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .agent-editor-row {
    display: flex;
    gap: var(--space-6);
    flex-wrap: wrap;
  }

  .agent-editor-row .settings-field {
    flex: 1;
    min-width: 120px;
  }

  .agent-editor-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-8) var(--space-10);
    border-top: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
  }

  .agent-editor-footer .settings-action-danger {
    margin-right: auto;
  }

  .agent-editor-error {
    color: var(--color-text-danger);
  }
</style>
