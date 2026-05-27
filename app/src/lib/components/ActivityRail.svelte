<script lang="ts">
  import HoverTooltip from "./HoverTooltip.svelte";
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

  function workspaceInitial(workspace: WorkspaceEntry): string {
    const name = workspaceName(workspace).trim();
    return (name[0] ?? "?").toUpperCase();
  }
</script>

<aside class="activity-rail" aria-label="Activity rail">
  <HoverTooltip label="Notepad">
    <button
      class={`rail-button ${activeContextId === "notepad" ? "rail-button-active" : ""}`}
      type="button"
      aria-label="Notepad"
      onclick={() => onSelectContext("notepad")}
    >
      N
    </button>
  </HoverTooltip>

  <div class="rail-separator" aria-hidden="true"></div>

  <div class="rail-workspaces">
    {#each workspaces as workspace (workspace.id)}
      <HoverTooltip label={workspaceName(workspace)} detail={workspace.rootPath}>
        <button
          class={`rail-button rail-button-workspace ${activeContextId === workspace.id ? "rail-button-active" : ""}`}
          type="button"
          aria-label={`Workspace ${workspaceName(workspace)}`}
          oncontextmenu={(event) => {
            event.preventDefault();
            onRequestCloseWorkspace(workspace.id, event.clientX, event.clientY);
          }}
          onclick={() => onSelectContext(workspace.id)}
        >
          <span class="rail-workspace-initial">{workspaceInitial(workspace)}</span>
        </button>
      </HoverTooltip>
    {/each}
  </div>

  <HoverTooltip label="Add Workspace">
    <button
      class="rail-button rail-button-add"
      type="button"
      aria-label="Add Workspace"
      onclick={onAddWorkspace}
    >
      +
    </button>
  </HoverTooltip>
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

  .rail-separator {
    width: 100%;
    height: 1px;
    background: var(--color-border-subtle);
    flex-shrink: 0;
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
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-text-primary);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 30%, transparent);
  }

  .rail-button-workspace {
    font-weight: 600;
  }

  .rail-workspace-initial {
    font-size: 12px;
    text-transform: uppercase;
  }

  .rail-button-add {
    margin-top: auto;
    font-size: 16px;
  }
</style>
