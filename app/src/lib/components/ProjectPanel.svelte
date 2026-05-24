<script lang="ts">
  import ProjectTreeView from "./ProjectTreeView.svelte";
  import type { ProjectTreeNode } from "../services/projectTree";

  export let workspaceRoot: string;
  export let rootNodes: ProjectTreeNode[] = [];
  export let expandedPaths = new Set<string>();
  export let childrenByPath = new Map<string, ProjectTreeNode[]>();
  export let loadingPaths = new Set<string>();
  export let activeFilePath: string | null = null;
  export let showHidden = false;
  export let collapsed = false;
  export let onRefresh: () => void = () => {};
  export let onToggleHidden: (next: boolean) => void = () => {};
  export let onToggleCollapsed: (next: boolean) => void = () => {};
  export let onToggleDirectory: (path: string) => void = () => {};
  export let onOpenFile: (path: string) => void = () => {};
  let panelBodyEl: HTMLDivElement | null = null;

  function basename(path: string): string {
    const normalized = path.replaceAll("\\", "/");
    const parts = normalized.split("/");
    return parts[parts.length - 1] || path;
  }

  $: if (panelBodyEl && activeFilePath) {
    const node = panelBodyEl.querySelector<HTMLElement>(`[data-path="${CSS.escape(activeFilePath)}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }
</script>

<aside class={`project-panel ${collapsed ? "project-panel-collapsed" : ""}`} aria-label="Project panel">
  <header class="project-panel-header">
    {#if !collapsed}
      <div class="project-panel-title" title={workspaceRoot}>{basename(workspaceRoot)}</div>
      <button class="project-panel-button" type="button" onclick={onRefresh} title="Refresh tree">↻</button>
      <button
        class="project-panel-button"
        type="button"
        onclick={() => onToggleHidden(!showHidden)}
        title={showHidden ? "Hide hidden files" : "Show hidden files"}
      >
        {showHidden ? "Hidden: On" : "Hidden: Off"}
      </button>
    {/if}
    <button
      class="project-panel-button"
      type="button"
      onclick={() => onToggleCollapsed(!collapsed)}
      title={collapsed ? "Expand panel" : "Collapse panel"}
    >
      {collapsed ? "›" : "‹"}
    </button>
  </header>

  {#if !collapsed}
    <div class="project-panel-body" bind:this={panelBodyEl}>
      <ProjectTreeView
        nodes={rootNodes}
        {expandedPaths}
        {childrenByPath}
        {loadingPaths}
        {activeFilePath}
        {onToggleDirectory}
        {onOpenFile}
      />
    </div>
  {/if}
</aside>

<style>
  .project-panel {
    width: var(--project-panel-width);
    border-left: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
  }

  .project-panel-collapsed {
    width: 36px;
    grid-template-rows: auto;
  }

  .project-panel-header {
    height: var(--tab-header-height);
    border-bottom: 1px solid var(--color-border-subtle);
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: 0 var(--space-6);
    min-width: 0;
  }

  .project-panel-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }

  .project-panel-button {
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    height: 22px;
    padding: 0 var(--space-6);
  }

  .project-panel-button:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .project-panel-body {
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
</style>
