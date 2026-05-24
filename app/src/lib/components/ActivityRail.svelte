<script lang="ts">
  import type { ContextId, WorkspaceEntry } from "../domain/contracts";

  export let workspaces: WorkspaceEntry[] = [];
  export let activeContextId: ContextId = "notepad";
  export let onSelectContext: (contextId: ContextId) => void = () => {};
  export let onAddWorkspace: () => void = () => {};
  export let onRequestCloseWorkspace: (workspaceId: ContextId, x: number, y: number) => void = () => {};

  function workspaceName(workspace: WorkspaceEntry): string {
    const normalized = workspace.rootPath.replaceAll("\\", "/");
    const parts = normalized.split("/");
    return parts[parts.length - 1] || workspace.rootPath;
  }
</script>

<aside class="activity-rail" aria-label="Activity rail">
  <button
    class={`rail-button ${activeContextId === "notepad" ? "rail-button-active" : ""}`}
    type="button"
    title="Notepad"
    aria-label="Notepad"
    onclick={() => onSelectContext("notepad")}
  >
    N
  </button>

  <div class="rail-workspaces">
    {#each workspaces as workspace (workspace.id)}
      <button
        class={`rail-button ${activeContextId === workspace.id ? "rail-button-active" : ""}`}
        type="button"
        title={workspace.rootPath}
        aria-label={`Workspace ${workspaceName(workspace)}`}
        oncontextmenu={(event) => {
          event.preventDefault();
          onRequestCloseWorkspace(workspace.id, event.clientX, event.clientY);
        }}
        onclick={() => onSelectContext(workspace.id)}
      >
        <span class="rail-folder-glyph">▢</span>
      </button>
    {/each}
  </div>

  <button
    class="rail-button rail-button-add"
    type="button"
    title="Add Workspace"
    aria-label="Add Workspace"
    onclick={onAddWorkspace}
  >
    +
  </button>
</aside>

<style>
  .activity-rail {
    width: var(--activity-rail-width);
    border-right: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-8) var(--space-6);
  }

  .rail-workspaces {
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-6);
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .rail-button {
    width: 32px;
    height: 32px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    line-height: 1;
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      border-color var(--motion-fast) var(--easing-standard),
      color var(--motion-fast) var(--easing-standard);
  }

  .rail-button:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .rail-button:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .rail-button-active {
    border-color: var(--color-border-subtle);
    background: var(--color-hover);
    color: var(--color-text-primary);
  }

  .rail-folder-glyph {
    font-size: 12px;
  }

  .rail-button-add {
    margin-top: auto;
    font-size: 16px;
  }
</style>
