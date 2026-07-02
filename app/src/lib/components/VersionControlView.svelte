<script lang="ts">
  /**
   * Per-workspace version control view, rendered as a chrome-less editor-pane
   * view tab (kind "version-control"). Opened from the workspace context menu;
   * the active workspace root path is passed in so phase 2/3 panels can scope
   * git operations to it.
   */
  let { workspaceRootPath }: { workspaceRootPath: string | null } = $props();

  type Section = "history" | "branches" | "tags" | "changes";

  const SECTIONS: ReadonlyArray<{ id: Section; label: string }> = [
    { id: "history", label: "History" },
    { id: "branches", label: "Branches" },
    { id: "tags", label: "Tags" },
    { id: "changes", label: "Changes" },
  ];

  let activeSection = $state<Section>("history");

  const workspaceName = $derived.by(() => {
    if (!workspaceRootPath) {
      return "Workspace";
    }
    const normalized = workspaceRootPath.replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? workspaceRootPath;
  });

  const placeholderCopy = $derived.by(() => {
    if (activeSection === "changes") {
      return "Coming in phase 3.";
    }
    return "Coming in phase 2.";
  });

  function selectSection(section: Section): void {
    activeSection = section;
  }
</script>

<div
  class="version-control-view"
  role="tabpanel"
  aria-label={`Version control — ${workspaceName}`}
>
  <header class="version-control-header" aria-label="Version control toolbar">
    <span class="version-control-branch" title="Current branch">
      <span class="version-control-branch-label">Branch</span>
      <span class="version-control-branch-name">—</span>
    </span>
    <div class="version-control-header-actions">
      <button type="button" class="version-control-action" disabled title="Fetch (phase 3)">
        Fetch
      </button>
      <button type="button" class="version-control-action" disabled title="Pull (phase 3)">
        Pull
      </button>
      <button type="button" class="version-control-action" disabled title="Push (phase 3)">
        Push
      </button>
    </div>
  </header>

  <div class="version-control-main">
    <div
      class="version-control-sidebar"
      role="tablist"
      aria-label="Version control sections"
    >
      <p class="version-control-title">{workspaceName}</p>
      {#each SECTIONS as section (section.id)}
        <button
          type="button"
          role="tab"
          class="version-control-tab"
          class:version-control-tab-active={activeSection === section.id}
          aria-selected={activeSection === section.id}
          onclick={() => selectSection(section.id)}
        >
          {section.label}
        </button>
      {/each}
    </div>

    <div
      class="version-control-body"
      role="tabpanel"
      aria-label={SECTIONS.find((section) => section.id === activeSection)?.label ?? "Section"}
    >
      <p class="version-control-placeholder">{placeholderCopy}</p>
    </div>
  </div>
</div>

<style>
  .version-control-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--color-surface-1);
  }

  .version-control-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .version-control-branch {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    font-size: 0.875rem;
  }

  .version-control-branch-label {
    color: var(--color-text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .version-control-branch-name {
    color: var(--color-text);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .version-control-header-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .version-control-action {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text);
    font-size: 0.8125rem;
    cursor: default;
  }

  .version-control-action:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .version-control-main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: row;
  }

  .version-control-sidebar {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-8) var(--space-4) var(--space-12);
    border-right: 1px solid var(--color-border-subtle);
    overflow-y: auto;
    width: 132px;
  }

  .version-control-title {
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

  .version-control-tab {
    text-align: left;
    padding: var(--space-2) var(--space-4);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .version-control-tab:hover {
    background: var(--color-surface-2);
  }

  .version-control-tab-active {
    background: var(--color-surface-2);
    font-weight: 600;
  }

  .version-control-body {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-10) var(--space-12) var(--space-12);
  }

  .version-control-placeholder {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }
</style>
