<script lang="ts">
  import { checkGitAvailable } from "../../git/gitService";
  import type { GitAvailableResponse } from "../../git/types";
  import { appState } from "../../state/appState";

  const snapshot = $derived($appState);
  const gitIntegration = $derived(snapshot.settings.gitIntegration);
  const gitIntegrationEnabled = $derived(gitIntegration.enabled);

  let gitInfo = $state<GitAvailableResponse | null>(null);
  let gitInfoLoading = $state(false);
  let gitInfoError = $state<string | null>(null);

  async function refreshGitInfo(): Promise<void> {
    gitInfoLoading = true;
    gitInfoError = null;
    try {
      gitInfo = await checkGitAvailable();
    } catch (error) {
      gitInfo = null;
      gitInfoError = error instanceof Error ? error.message : "Could not probe git.";
    } finally {
      gitInfoLoading = false;
    }
  }

  $effect(() => {
    if (gitIntegrationEnabled) {
      void refreshGitInfo();
    } else {
      gitInfo = null;
      gitInfoError = null;
      gitInfoLoading = false;
    }
  });

  function updateGitIntegrationEnabled(enabled: boolean): void {
    appState.setGitIntegrationEnabled(enabled);
  }

  function updateGitIntegrationOption(
    key: "autosaveBeforeOperations" | "showProjectTreeBadges" | "showWorkspaceManagerGitColumn",
    value: boolean,
  ): void {
    appState.updateGitIntegrationSettings({ [key]: value });
  }
</script>

<section class="settings-section">
  <h3>Git integration</h3>
  <p class="settings-section-note">
    When disabled, SpecOps stops launching git commands, hides the Version Control
    workspace menu item, closes any open Version Control tabs, and turns off
    background git probes.
  </p>
  <label class="settings-toggle" title="Enable git integration">
    <input
      type="checkbox"
      checked={gitIntegrationEnabled}
      title="Enable git integration"
      onchange={(event) =>
        updateGitIntegrationEnabled((event.currentTarget as HTMLInputElement).checked)}
    />
    Enable git integration
  </label>
</section>

{#if gitIntegrationEnabled}
  <section class="settings-section">
    <h3>Git binary</h3>
    <p class="settings-section-note">
      System git used by Version Control, project-tree badges, and the Workspace
      Manager git column.
    </p>
    <div class="settings-subsection">
      <button
        type="button"
        class="settings-action-button"
        disabled={gitInfoLoading}
        onclick={() => void refreshGitInfo()}
      >
        {gitInfoLoading ? "Checking…" : "Refresh"}
      </button>
      {#if gitInfoError}
        <p class="settings-section-note">{gitInfoError}</p>
      {:else if gitInfo}
        <dl class="settings-info-list">
          <div>
            <dt>Status</dt>
            <dd>{gitInfo.available ? "Available" : "Not found"}</dd>
          </div>
          {#if gitInfo.version}
            <div>
              <dt>Version</dt>
              <dd>{gitInfo.version}</dd>
            </div>
          {/if}
          {#if gitInfo.resolvedPath}
            <div>
              <dt>Path</dt>
              <dd>{gitInfo.resolvedPath}</dd>
            </div>
          {/if}
          {#if gitInfo.error}
            <div>
              <dt>Error</dt>
              <dd>{gitInfo.error}</dd>
            </div>
          {/if}
        </dl>
      {/if}
    </div>
  </section>

  <section class="settings-section">
    <h3>Options</h3>
    <div class="settings-subsection">
      <label class="settings-toggle" title="Autosave open files before git operations">
        <input
          type="checkbox"
          checked={gitIntegration.autosaveBeforeOperations}
          title="Autosave open files before git operations"
          onchange={(event) =>
            updateGitIntegrationOption(
              "autosaveBeforeOperations",
              (event.currentTarget as HTMLInputElement).checked,
            )}
        />
        Autosave open files before git operations
      </label>
      <label class="settings-toggle" title="Show git status badges in project tree">
        <input
          type="checkbox"
          checked={gitIntegration.showProjectTreeBadges}
          title="Show git status badges in project tree"
          onchange={(event) =>
            updateGitIntegrationOption(
              "showProjectTreeBadges",
              (event.currentTarget as HTMLInputElement).checked,
            )}
        />
        Show git status badges in project tree
      </label>
      <label class="settings-toggle" title="Show git column in Workspace Manager">
        <input
          type="checkbox"
          checked={gitIntegration.showWorkspaceManagerGitColumn}
          title="Show git column in Workspace Manager"
          onchange={(event) =>
            updateGitIntegrationOption(
              "showWorkspaceManagerGitColumn",
              (event.currentTarget as HTMLInputElement).checked,
            )}
        />
        Show git column in Workspace Manager
      </label>
    </div>
  </section>
{/if}

<style>
  .settings-info-list {
    margin: var(--space-4) 0 0;
    display: grid;
    gap: var(--space-2);
  }

  .settings-info-list div {
    display: grid;
    grid-template-columns: 5rem 1fr;
    gap: var(--space-4);
    font-size: 0.85rem;
  }

  .settings-info-list dt {
    margin: 0;
    color: var(--color-text-muted);
    font-weight: 600;
  }

  .settings-info-list dd {
    margin: 0;
    word-break: break-all;
  }

  .settings-action-button {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .settings-action-button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
