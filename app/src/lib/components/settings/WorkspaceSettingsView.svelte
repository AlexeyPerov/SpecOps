<script lang="ts">
  import LineCounterPanel from "./LineCounterPanel.svelte";
  import { isHiddenFromRail, setHiddenFromRail } from "../../services/workspacePreferences";

  /**
   * Per-workspace settings view, rendered as a chrome-less editor-pane view tab
   * (kind "workspace-settings"). Opened from the workspace context menu's
   * "Settings" action; the active workspace's root path is passed in so every
   * section can scope to it.
   */
  let { workspaceRootPath }: { workspaceRootPath: string | null } = $props();

  type Section = "overview";

  const SECTIONS: ReadonlyArray<{ id: Section; label: string }> = [
    { id: "overview", label: "Overview" },
  ];

  let activeSection = $state<Section>("overview");
  /**
   * Local mirror of the hide-from-rail flag. The global preference store is the
   * source of truth (and notifies the activity rail on change); this local copy
   * lets the toggle render instantly without waiting for the store callback,
   * and re-syncs when the workspace root changes.
   */
  let showInSidebar = $state(true);

  // Re-sync when the scoping root changes (switching between workspace-settings
  // tabs reuses the component, so the effect keeps the toggle honest).
  $effect(() => {
    const root = workspaceRootPath;
    showInSidebar = root ? !isHiddenFromRail(root) : true;
  });

  const workspaceName = $derived.by(() => {
    if (!workspaceRootPath) {
      return "Workspace";
    }
    const normalized = workspaceRootPath.replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? workspaceRootPath;
  });

  function selectSection(section: Section): void {
    activeSection = section;
  }

  async function handleToggleShowInSidebar(checked: boolean): Promise<void> {
    showInSidebar = checked;
    if (!workspaceRootPath) {
      return;
    }
    // Store is keyed by normalized path; setHiddenFromRail normalizes internally
    // (decision 9). `hiddenFromRail` is the inverse of "Show in sidebar".
    await setHiddenFromRail(workspaceRootPath, !checked);
  }
</script>

<div class="workspace-settings-view" role="tabpanel" aria-label={`Workspace settings — ${workspaceName}`}>
  <div
    class="workspace-settings-sidebar"
    role="tablist"
    aria-label="Workspace settings sections"
  >
    <p class="workspace-settings-title">{workspaceName}</p>
    {#each SECTIONS as section (section.id)}
      <button
        type="button"
        role="tab"
        class="workspace-settings-tab"
        class:workspace-settings-tab-active={activeSection === section.id}
        aria-selected={activeSection === section.id}
        onclick={() => selectSection(section.id)}
      >
        {section.label}
      </button>
    {/each}
  </div>

  <div
    class="workspace-settings-body"
    role="tabpanel"
    aria-label="Workspace overview"
  >
    {#if activeSection === "overview"}
      <section class="settings-section workspace-sidebar-section">
        <h3>Sidebar</h3>
        <p class="settings-section-note">
          Hidden workspaces stay open and switchable from the Workspace Manager,
          but are omitted from the activity rail in every window.
        </p>
        <label class="workspace-sidebar-toggle">
          <input
            type="checkbox"
            checked={showInSidebar}
            disabled={!workspaceRootPath}
            onchange={(event) => {
              const target = event.currentTarget as HTMLInputElement;
              void handleToggleShowInSidebar(target.checked);
            }}
          />
          <span>Show in sidebar</span>
        </label>
      </section>
      <LineCounterPanel workspaceRoot={workspaceRootPath} />
    {/if}
  </div>
</div>

<style>
  .workspace-settings-view {
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--color-surface-1);
  }

  .workspace-settings-sidebar {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-8) var(--space-4) var(--space-12);
    border-right: 1px solid var(--color-border-subtle);
    overflow-y: auto;
    width: 132px;
  }

  .workspace-settings-title {
    margin: 0 0 var(--space-4);
    padding: 0 var(--space-4);
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-settings-tab {
    text-align: left;
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .workspace-settings-tab:hover {
    background: var(--color-surface-2);
  }

  .workspace-settings-tab-active {
    background: var(--color-surface-2);
    font-weight: 600;
  }

  .workspace-settings-body {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-10) var(--space-12) var(--space-12);
  }

  .workspace-sidebar-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: flex-start;
    margin-bottom: var(--space-10);
  }

  .workspace-sidebar-section h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .settings-section-note {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    max-width: 52ch;
  }

  .workspace-sidebar-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    font-size: 0.875rem;
    cursor: pointer;
    user-select: none;
  }

  .workspace-sidebar-toggle input {
    cursor: pointer;
  }

  .workspace-sidebar-toggle input:disabled {
    cursor: default;
  }
</style>
