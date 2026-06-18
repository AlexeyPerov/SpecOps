<script lang="ts">
  import { chatStore } from "../../state/chatStore";
  import {
    getOpencodeConfigStore,
    isConfigStoreAvailable,
    loadOpencodeConfigStore,
    saveOpencodeConfig,
  } from "../../ai/opencodeConfigStore";
  import {
    getConfigAutoupdate,
    getConfigCompaction,
    getConfigDefaultAgent,
    getConfigExperimental,
    getConfigInstructions,
    getConfigModel,
    getConfigShare,
    getConfigSkills,
    getConfigSmallModel,
    getConfigSnapshot,
    getConfigToolOutput,
    getConfigUsername,
    parseConfigJson,
    serializeConfigJson,
    setConfigAutoupdate,
    setConfigCompaction,
    setConfigDefaultAgent,
    setConfigExperimental,
    setConfigInstructions,
    setConfigModel,
    setConfigShare,
    setConfigSmallModel,
    setConfigSnapshot,
    setConfigToolOutput,
    setConfigUsername,
    setConfigSkills,
    type ConfigAutoupdate,
    type ConfigShareMode,
  } from "../../ai/backends/opencodeConfig";
  import type { OpencodeConfigDocument } from "../../ai/backends/workspaceAgentBackend";

  let { dialogOpen = false }: { dialogOpen?: boolean } = $props();

  type Tab = "form" | "json";
  let activeTab = $state<Tab>("form");

  const workspaceRoot = $derived(chatStore.getActiveWorkspaceRoot());
  const available = $derived(isConfigStoreAvailable(workspaceRoot));
  const store = $derived(
    workspaceRoot ? getOpencodeConfigStore(workspaceRoot) : null,
  );

  // Local working copy of the config doc — edited in place, saved on demand.
  let draft = $state<OpencodeConfigDocument | null>(null);
  let rawJson = $state("");
  let rawJsonError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  let saving = $state(false);
  let wasDialogOpen = false;

  // Sync the draft from the store whenever a fresh load arrives.
  $effect(() => {
    void store?.loadedAt;
    if (store?.config) {
      draft = structuredClone(store.config);
      rawJson = serializeConfigJson(store.config);
      rawJsonError = null;
    }
  });

  $effect(() => {
    if (dialogOpen && !wasDialogOpen && workspaceRoot && available) {
      void loadOpencodeConfigStore(workspaceRoot);
    }
    wasDialogOpen = dialogOpen;
  });

  function ensureDraft(): OpencodeConfigDocument {
    if (!draft) {
      draft = {};
    }
    return draft;
  }

  function persist(next: OpencodeConfigDocument): void {
    draft = next;
    rawJson = serializeConfigJson(next);
    rawJsonError = null;
  }

  async function handleSave(): Promise<void> {
    if (!workspaceRoot || !draft) {
      return;
    }
    // If the JSON tab is active, parse the raw text first so manual edits land.
    let toSave = draft;
    if (activeTab === "json") {
      try {
        toSave = parseConfigJson(rawJson);
        draft = toSave;
      } catch (error: unknown) {
        rawJsonError = error instanceof Error ? error.message : "Invalid JSON.";
        return;
      }
    }
    saving = true;
    saveError = null;
    const state = await saveOpencodeConfig(workspaceRoot, toSave);
    saving = false;
    if (state.status === "error") {
      saveError = state.lastErrorMessage;
    } else {
      rawJson = serializeConfigJson(state.config ?? toSave);
    }
  }

  function handleReload(): void {
    if (workspaceRoot) {
      void loadOpencodeConfigStore(workspaceRoot);
    }
  }

  // --- field handlers (form tab) ---
  function updateModel(value: string): void {
    persist(setConfigModel(ensureDraft(), value));
  }
  function updateSmallModel(value: string): void {
    persist(setConfigSmallModel(ensureDraft(), value));
  }
  function updateDefaultAgent(value: string): void {
    persist(setConfigDefaultAgent(ensureDraft(), value));
  }
  function updateUsername(value: string): void {
    persist(setConfigUsername(ensureDraft(), value));
  }
  function updateShare(value: ConfigShareMode): void {
    persist(setConfigShare(ensureDraft(), value));
  }
  function updateAutoupdate(value: ConfigAutoupdate): void {
    persist(setConfigAutoupdate(ensureDraft(), value));
  }
  function updateSnapshot(value: boolean): void {
    persist(setConfigSnapshot(ensureDraft(), value));
  }
  function updateInstructions(value: string): void {
    persist(setConfigInstructions(ensureDraft(), value.split("\n")));
  }
  function updateSkillPaths(value: string): void {
    const skills = getConfigSkills(ensureDraft());
    persist(setConfigSkills(ensureDraft(), { ...skills, paths: value.split("\n") }));
  }
  function updateSkillUrls(value: string): void {
    const skills = getConfigSkills(ensureDraft());
    persist(setConfigSkills(ensureDraft(), { ...skills, urls: value.split("\n") }));
  }
  function updateToolOutputMaxLines(value: string): void {
    const toolOutput = getConfigToolOutput(ensureDraft());
    const parsed = value.trim().length === 0 ? undefined : Number(value);
    persist(
      setConfigToolOutput(ensureDraft(), {
        ...toolOutput,
        maxLines: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
      }),
    );
  }
  function updateToolOutputMaxBytes(value: string): void {
    const toolOutput = getConfigToolOutput(ensureDraft());
    const parsed = value.trim().length === 0 ? undefined : Number(value);
    persist(
      setConfigToolOutput(ensureDraft(), {
        ...toolOutput,
        maxBytes: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
      }),
    );
  }
  function updateCompactionAuto(value: boolean): void {
    const compaction = getConfigCompaction(ensureDraft());
    persist(setConfigCompaction(ensureDraft(), { ...compaction, auto: value }));
  }
  function updateCompactionPrune(value: boolean): void {
    const compaction = getConfigCompaction(ensureDraft());
    persist(setConfigCompaction(ensureDraft(), { ...compaction, prune: value }));
  }
  function updateCompactionTailTurns(value: string): void {
    const compaction = getConfigCompaction(ensureDraft());
    const parsed = value.trim().length === 0 ? undefined : Number(value);
    persist(
      setConfigCompaction(ensureDraft(), {
        ...compaction,
        tailTurns: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
      }),
    );
  }
  function updateExperimental(key: "batchTool" | "openTelemetry" | "disablePasteSummary" | "continueLoopOnDeny", value: boolean): void {
    const experimental = getConfigExperimental(ensureDraft());
    persist(setConfigExperimental(ensureDraft(), { ...experimental, [key]: value }));
  }
  function updateExperimentalPrimaryTools(value: string): void {
    const experimental = getConfigExperimental(ensureDraft());
    persist(
      setConfigExperimental(ensureDraft(), {
        ...experimental,
        primaryTools: value.split("\n").map((t) => t.trim()).filter((t) => t.length > 0),
      }),
    );
  }

  function onRawJsonInput(event: Event): void {
    rawJson = (event.currentTarget as HTMLTextAreaElement).value;
    rawJsonError = null;
  }

  function syncJsonToDraft(): void {
    try {
      draft = parseConfigJson(rawJson);
      rawJsonError = null;
    } catch (error: unknown) {
      rawJsonError = error instanceof Error ? error.message : "Invalid JSON.";
    }
  }
</script>

{#if !available}
  <section class="settings-section">
    <h3>OpenCode config</h3>
    <p class="settings-section-note">
      Open a workspace folder with OpenCode enabled to edit its configuration here.
    </p>
  </section>
{:else if store?.status === "error"}
  <section class="settings-section">
    <h3>OpenCode config</h3>
    <p class="settings-section-note opencode-config-error">
      {store.lastErrorMessage ?? "Failed to load OpenCode config."}
    </p>
    <button type="button" class="settings-action" onclick={handleReload}>Retry</button>
  </section>
{:else}
  <section class="settings-section">
    <div class="opencode-config-header">
      <h3>OpenCode config</h3>
      <div class="opencode-config-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="opencode-config-tab"
          class:opencode-config-tab-active={activeTab === "form"}
          aria-selected={activeTab === "form"}
          onclick={() => (activeTab = "form")}
        >
          Form
        </button>
        <button
          type="button"
          role="tab"
          class="opencode-config-tab"
          class:opencode-config-tab-active={activeTab === "json"}
          aria-selected={activeTab === "json"}
          onclick={() => {
            if (activeTab === "form") {
              syncJsonToDraft();
            }
            activeTab = "json";
          }}
        >
          Raw JSON
        </button>
      </div>
    </div>

    {#if store?.status === "loading" && !draft}
      <p class="settings-section-note">Loading config…</p>
    {:else if draft}
      {#if activeTab === "form"}
        <div class="settings-subsection">
          <h4>Models &amp; agent</h4>
          <label class="settings-field">
            <span>Primary model</span>
            <input
              type="text"
              spellcheck="false"
              placeholder="provider/model"
              value={getConfigModel(draft)}
              oninput={(event) => updateModel((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <label class="settings-field">
            <span>Small model</span>
            <input
              type="text"
              spellcheck="false"
              placeholder="provider/small-model"
              value={getConfigSmallModel(draft)}
              oninput={(event) => updateSmallModel((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <label class="settings-field">
            <span>Default agent</span>
            <input
              type="text"
              spellcheck="false"
              placeholder="build"
              value={getConfigDefaultAgent(draft)}
              oninput={(event) => updateDefaultAgent((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <label class="settings-field">
            <span>Username</span>
            <input
              type="text"
              spellcheck="false"
              placeholder="your-name"
              value={getConfigUsername(draft)}
              oninput={(event) => updateUsername((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
        </div>

        <div class="settings-subsection">
          <h4>Sharing &amp; updates</h4>
          <label class="settings-field">
            <span>Share mode</span>
            <select
              value={getConfigShare(draft)}
              onchange={(event) => updateShare((event.currentTarget as HTMLSelectElement).value as ConfigShareMode)}
            >
              <option value="manual">Manual</option>
              <option value="auto">Auto</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label class="settings-field">
            <span>Auto-update</span>
            <select
              value={String(getConfigAutoupdate(draft))}
              onchange={(event) => {
                const value = (event.currentTarget as HTMLSelectElement).value;
                updateAutoupdate(value === "notify" ? "notify" : value === "true");
              }}
            >
              <option value="true">On</option>
              <option value="false">Off</option>
              <option value="notify">Notify</option>
            </select>
          </label>
          <label class="settings-toggle">
            <input
              type="checkbox"
              checked={getConfigSnapshot(draft)}
              onchange={(event) => updateSnapshot((event.currentTarget as HTMLInputElement).checked)}
            />
            Snapshot file changes (enables undo)
          </label>
        </div>

        <div class="settings-subsection">
          <h4>Tool output truncation</h4>
          <label class="settings-field">
            <span>Max lines</span>
            <input
              type="number"
              min="0"
              placeholder="unset"
              value={getConfigToolOutput(draft).maxLines ?? ""}
              onchange={(event) => updateToolOutputMaxLines((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <label class="settings-field">
            <span>Max bytes</span>
            <input
              type="number"
              min="0"
              placeholder="unset"
              value={getConfigToolOutput(draft).maxBytes ?? ""}
              onchange={(event) => updateToolOutputMaxBytes((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
        </div>

        <div class="settings-subsection">
          <h4>Compaction</h4>
          <label class="settings-toggle">
            <input
              type="checkbox"
              checked={getConfigCompaction(draft).auto}
              onchange={(event) => updateCompactionAuto((event.currentTarget as HTMLInputElement).checked)}
            />
            Auto-compact long sessions
          </label>
          <label class="settings-toggle">
            <input
              type="checkbox"
              checked={getConfigCompaction(draft).prune}
              onchange={(event) => updateCompactionPrune((event.currentTarget as HTMLInputElement).checked)}
            />
            Prune compacted messages
          </label>
          <label class="settings-field">
            <span>Tail turns</span>
            <input
              type="number"
              min="0"
              placeholder="unset"
              value={getConfigCompaction(draft).tailTurns ?? ""}
              onchange={(event) => updateCompactionTailTurns((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
        </div>

        <div class="settings-subsection">
          <h4>Instructions</h4>
          <p class="settings-section-note">One file path per line.</p>
          <textarea
            rows="3"
            spellcheck="false"
            placeholder="AGENTS.md"
            value={getConfigInstructions(draft).join("\n")}
            onchange={(event) => updateInstructions((event.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
        </div>

        <div class="settings-subsection">
          <h4>Skills</h4>
          <label class="settings-field">
            <span>Paths (one per line)</span>
            <textarea
              rows="2"
              spellcheck="false"
              value={getConfigSkills(draft).paths.join("\n")}
              onchange={(event) => updateSkillPaths((event.currentTarget as HTMLTextAreaElement).value)}
            ></textarea>
          </label>
          <label class="settings-field">
            <span>URLs (one per line)</span>
            <textarea
              rows="2"
              spellcheck="false"
              value={getConfigSkills(draft).urls.join("\n")}
              onchange={(event) => updateSkillUrls((event.currentTarget as HTMLTextAreaElement).value)}
            ></textarea>
          </label>
        </div>

        <div class="settings-subsection">
          <h4>Experimental</h4>
          <label class="settings-toggle">
            <input
              type="checkbox"
              checked={getConfigExperimental(draft).batchTool}
              onchange={(event) => updateExperimental("batchTool", (event.currentTarget as HTMLInputElement).checked)}
            />
            Batch tool calls
          </label>
          <label class="settings-toggle">
            <input
              type="checkbox"
              checked={getConfigExperimental(draft).openTelemetry}
              onchange={(event) => updateExperimental("openTelemetry", (event.currentTarget as HTMLInputElement).checked)}
            />
            OpenTelemetry
          </label>
          <label class="settings-toggle">
            <input
              type="checkbox"
              checked={getConfigExperimental(draft).disablePasteSummary}
              onchange={(event) => updateExperimental("disablePasteSummary", (event.currentTarget as HTMLInputElement).checked)}
            />
            Disable paste summary
          </label>
          <label class="settings-toggle">
            <input
              type="checkbox"
              checked={getConfigExperimental(draft).continueLoopOnDeny}
              onchange={(event) => updateExperimental("continueLoopOnDeny", (event.currentTarget as HTMLInputElement).checked)}
            />
            Continue loop on deny
          </label>
          <label class="settings-field">
            <span>Primary tools (one per line)</span>
            <textarea
              rows="2"
              spellcheck="false"
              value={getConfigExperimental(draft).primaryTools.join("\n")}
              onchange={(event) => updateExperimentalPrimaryTools((event.currentTarget as HTMLTextAreaElement).value)}
            ></textarea>
          </label>
        </div>
      {:else}
        <div class="settings-subsection">
          <p class="settings-section-note">
            Edit the raw config document. Saving validates the JSON and writes it back through
            <code>config.update</code>.
          </p>
          <textarea
            class="opencode-config-raw"
            rows="20"
            spellcheck="false"
            value={rawJson}
            oninput={onRawJsonInput}
          ></textarea>
          {#if rawJsonError}
            <p class="settings-section-note opencode-config-error">{rawJsonError}</p>
          {/if}
        </div>
      {/if}

      {#if saveError}
        <p class="settings-section-note opencode-config-error">{saveError}</p>
      {/if}
      <div class="opencode-config-actions">
        <button type="button" class="settings-action" onclick={handleReload} disabled={saving}>
          Reload
        </button>
        <button type="button" class="settings-action" onclick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    {/if}
  </section>
{/if}

<style>
  @import "../../styles/settingsForm.css";
  @import "../../styles/settingsFormMultiline.css";
  @import "../../styles/settingsDialogForm.css";

  .opencode-config-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    flex-wrap: wrap;
  }

  .opencode-config-tabs {
    display: inline-flex;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .opencode-config-tab {
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    padding: var(--space-2) var(--space-6);
    cursor: pointer;
    font: inherit;
  }

  .opencode-config-tab-active {
    background: var(--color-hover);
    color: var(--color-text-primary);
  }

  .opencode-config-raw {
    width: 100%;
    min-height: 320px;
    font-family: var(--font-mono, monospace);
    font-size: 0.8125rem;
    resize: vertical;
  }

  .opencode-config-actions {
    display: flex;
    gap: var(--space-4);
    margin-top: var(--space-6);
  }

  .opencode-config-error {
    color: var(--color-text-danger);
  }
</style>
