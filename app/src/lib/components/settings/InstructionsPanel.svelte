<script lang="ts">
  import { chatStore } from "../../state/chatStore";
  import {
    getOpencodeConfigStore,
    isConfigStoreAvailable,
    loadOpencodeConfigStore,
    saveOpencodeConfig,
  } from "../../ai/opencodeConfigStore";
  import {
    getConfigInstructions,
    getConfigSkills,
    setConfigInstructions,
    setConfigSkills,
  } from "../../ai/backends/opencodeConfig";

  let { dialogOpen = false }: { dialogOpen?: boolean } = $props();

  const workspaceRoot = $derived(chatStore.getActiveWorkspaceRoot());
  const available = $derived(isConfigStoreAvailable(workspaceRoot));
  const store = $derived(
    workspaceRoot ? getOpencodeConfigStore(workspaceRoot) : null,
  );

  let instructionsDraft = $state("");
  let skillPathsDraft = $state("");
  let skillUrlsDraft = $state("");
  let dirty = $state(false);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let wasDialogOpen = false;

  $effect(() => {
    void store?.loadedAt;
    if (store?.config) {
      instructionsDraft = getConfigInstructions(store.config).join("\n");
      const skills = getConfigSkills(store.config);
      skillPathsDraft = skills.paths.join("\n");
      skillUrlsDraft = skills.urls.join("\n");
      dirty = false;
    }
  });

  $effect(() => {
    if (dialogOpen && !wasDialogOpen && workspaceRoot && available) {
      void loadOpencodeConfigStore(workspaceRoot);
    }
    wasDialogOpen = dialogOpen;
  });

  function markDirty(): void {
    dirty = true;
    saveError = null;
  }

  function handleInstructionsInput(event: Event): void {
    instructionsDraft = (event.currentTarget as HTMLTextAreaElement).value;
    markDirty();
  }
  function handleSkillPathsInput(event: Event): void {
    skillPathsDraft = (event.currentTarget as HTMLTextAreaElement).value;
    markDirty();
  }
  function handleSkillUrlsInput(event: Event): void {
    skillUrlsDraft = (event.currentTarget as HTMLTextAreaElement).value;
    markDirty();
  }

  async function handleSave(): Promise<void> {
    const config = store?.config;
    if (!workspaceRoot || !config) {
      return;
    }
    let next = setConfigInstructions(config, instructionsDraft.split("\n"));
    next = setConfigSkills(next, {
      paths: skillPathsDraft.split("\n"),
      urls: skillUrlsDraft.split("\n"),
    });
    saving = true;
    saveError = null;
    const state = await saveOpencodeConfig(workspaceRoot, next);
    saving = false;
    if (state.status === "error") {
      saveError = state.lastErrorMessage;
    } else {
      dirty = false;
    }
  }

  function handleReload(): void {
    if (workspaceRoot) {
      void loadOpencodeConfigStore(workspaceRoot);
    }
  }
</script>

{#if !available}
  <section class="settings-section">
    <h3>Instructions &amp; skills</h3>
    <p class="settings-section-note">
      Open a workspace folder with OpenCode enabled to manage instructions and skills.
    </p>
  </section>
{:else if store?.status === "error"}
  <section class="settings-section">
    <h3>Instructions &amp; skills</h3>
    <p class="settings-section-note instructions-error">
      {store.lastErrorMessage ?? "Failed to load config."}
    </p>
    <button type="button" class="settings-action" onclick={handleReload}>Retry</button>
  </section>
{:else}
  <section class="settings-section">
    <h3>Instructions &amp; skills</h3>

    <div class="settings-subsection">
      <h4>Instructions</h4>
      <p class="settings-section-note">Markdown files appended to every agent prompt. One path per line.</p>
      <textarea
        rows="4"
        spellcheck="false"
        placeholder="AGENTS.md"
        value={instructionsDraft}
        oninput={handleInstructionsInput}
      ></textarea>
    </div>

    <div class="settings-subsection">
      <h4>Skills</h4>
      <p class="settings-section-note">
        Additional skill locations. Auto-discovered skills are listed below (read-only).
      </p>
      <label class="settings-field">
        <span>Paths (one per line)</span>
        <textarea
          rows="3"
          spellcheck="false"
          value={skillPathsDraft}
          oninput={handleSkillPathsInput}
        ></textarea>
      </label>
      <label class="settings-field">
        <span>URLs (one per line)</span>
        <textarea
          rows="2"
          spellcheck="false"
          value={skillUrlsDraft}
          oninput={handleSkillUrlsInput}
        ></textarea>
      </label>
    </div>

    <div class="settings-subsection">
      <h4>Discovered skills</h4>
      {#if (store?.skills ?? []).length === 0}
        <p class="settings-section-note">No skills auto-discovered for this workspace.</p>
      {:else}
        <div class="connection-list">
          {#each store?.skills ?? [] as skill (skill.name + skill.location)}
            <div class="connection-row skill-row">
              <div class="skill-row-main">
                <span class="skill-row-name">{skill.name}</span>
                {#if skill.description}<span class="skill-row-desc">{skill.description}</span>{/if}
                <span class="skill-row-location">{skill.location}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    {#if saveError}<p class="settings-section-note instructions-error">{saveError}</p>{/if}
    <div class="instructions-actions">
      <button type="button" class="settings-action" onclick={handleSave} disabled={saving || !dirty}>
        {saving ? "Saving…" : "Save"}
      </button>
      <button type="button" class="settings-action" onclick={handleReload}>Reload</button>
    </div>
  </section>
{/if}

<style>
  .skill-row-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    flex: 1;
    min-width: 0;
  }

  .skill-row-name {
    font-weight: 600;
  }

  .skill-row-desc {
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
  }

  .skill-row-location {
    color: var(--color-text-secondary);
    font-size: 0.7rem;
    font-family: var(--font-mono, monospace);
  }

  .instructions-actions {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .instructions-error {
    color: var(--color-text-danger);
  }
</style>
