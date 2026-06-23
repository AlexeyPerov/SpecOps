<script lang="ts">
  import { onDestroy } from "svelte";
  import HoverTooltip from "./HoverTooltip.svelte";
  import { CHAT_HTTP_CONTEXT_ID, type ContextId, type WorkspaceEntry } from "../domain/contracts";
  import {
    createWorkspaceRailDragController,
    previewWorkspaces,
    type WorkspaceDragState,
  } from "./workspaceRailDragController";

  export let workspaces: WorkspaceEntry[] = [];
  export let activeContextId: ContextId = "notepad";
  export let showChatHttp = false;
  export let onSelectContext: (contextId: ContextId) => void = () => {};
  export let onAddWorkspace: () => void = () => {};
  export let onRequestCloseWorkspace: (workspaceId: ContextId, x: number, y: number) => void = () => {};
  export let onReorderWorkspaces: (fromIndex: number, toIndex: number) => void = () => {};

  let activityRailEl: HTMLElement | null = null;
  let railWorkspacesEl: HTMLDivElement | null = null;

  let dragState: WorkspaceDragState = {
    pointerId: null,
    pressedWorkspaceId: null,
    dragWorkspaceId: null,
    dragFromIndex: -1,
    dropIndex: -1,
    dragOffsetX: 0,
    dragOffsetY: 0,
    dragPointerX: 0,
    dragPointerY: 0,
    dragPointerStartX: 0,
    dragPointerStartY: 0,
    dragWorkspaceRect: null,
    activityRailRect: null,
    workspaceRects: new Map(),
    didDrag: false,
    isFinishingDrag: false,
  };

  $: dragEnabled = workspaces.length > 1;
  $: workspacesForRender = previewWorkspaces(
    workspaces,
    dragState.didDrag,
    dragState.dragFromIndex,
    dragState.dropIndex,
  );
  $: draggedWorkspace = dragState.dragWorkspaceId
    ? (workspaces.find((workspace) => workspace.id === dragState.dragWorkspaceId) ?? null)
    : null;
  $: ghostLeft =
    dragState.activityRailRect && dragState.dragWorkspaceRect
      ? dragState.dragPointerX - dragState.dragOffsetX - dragState.activityRailRect.left
      : 0;
  $: ghostTop =
    dragState.activityRailRect && dragState.dragWorkspaceRect
      ? dragState.dragPointerY - dragState.dragOffsetY - dragState.activityRailRect.top
      : 0;

  const dragController = createWorkspaceRailDragController({
    getWorkspaces: () => workspaces,
    getRailWorkspacesEl: () => railWorkspacesEl,
    getActivityRailEl: () => activityRailEl,
    onSelect: (workspaceId) => onSelectContext(workspaceId),
    onReorder: (fromIndex, toIndex) => onReorderWorkspaces(fromIndex, toIndex),
    onStateChange: (nextState) => {
      dragState = nextState;
    },
  });

  function workspaceName(workspace: WorkspaceEntry): string {
    const normalized = workspace.rootPath.replaceAll("\\", "/");
    const parts = normalized.split("/");
    return parts[parts.length - 1] || workspace.rootPath;
  }

  function workspaceInitial(workspace: WorkspaceEntry): string {
    const name = workspaceName(workspace).trim();
    return (name[0] ?? "?").toUpperCase();
  }

  onDestroy(() => {
    dragController.destroy();
  });
</script>

<aside
  class="activity-rail"
  class:activity-rail-dragging={dragState.didDrag}
  aria-label="Activity rail"
  bind:this={activityRailEl}
>
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

  {#if showChatHttp}
    <HoverTooltip label="Chat (beta)">
      <button
        class={`rail-button rail-button-chat ${activeContextId === CHAT_HTTP_CONTEXT_ID ? "rail-button-active" : ""}`}
        type="button"
        aria-label="Chat (beta)"
        title="Chat (beta) — experimental HTTP chat context"
        onclick={() => onSelectContext(CHAT_HTTP_CONTEXT_ID)}
      >
        <svg
          class="rail-chat-icon"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M3.5 2.5H11.5C12.3284 2.5 13 3.17157 13 4V9C13 9.82843 12.3284 10.5 11.5 10.5H7.5L4.5 12.5V10.5H3.5C2.67157 10.5 2 9.82843 2 9V4C2 3.17157 2.67157 2.5 3.5 2.5Z"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </HoverTooltip>
  {/if}

  <div class="rail-workspaces" bind:this={railWorkspacesEl}>
    {#each workspacesForRender as workspace (workspace.id)}
      {#if dragState.didDrag && workspace.id === dragState.dragWorkspaceId}
        <span
          class="rail-workspace-placeholder"
          style={`width:${dragState.dragWorkspaceRect?.width ?? 32}px; height:${dragState.dragWorkspaceRect?.height ?? 32}px;`}
        ></span>
      {:else}
        <HoverTooltip label={workspaceName(workspace)} detail={workspace.rootPath}>
          <button
            class={`rail-button rail-button-workspace ${activeContextId === workspace.id ? "rail-button-active" : ""}`}
            data-workspace-id={workspace.id}
            type="button"
            aria-label={`Workspace ${workspaceName(workspace)}`}
            oncontextmenu={(event) => {
              event.preventDefault();
              onRequestCloseWorkspace(workspace.id, event.clientX, event.clientY);
            }}
            onpointerdown={(event) => {
              if (!dragEnabled) {
                return;
              }
              dragController.pointerDown(
                event,
                workspace,
                workspaces.findIndex((entry) => entry.id === workspace.id),
              );
            }}
            onclick={() => {
              if (!dragEnabled) {
                onSelectContext(workspace.id);
              }
            }}
          >
            <span class="rail-workspace-initial">{workspaceInitial(workspace)}</span>
          </button>
        </HoverTooltip>
      {/if}
    {/each}
  </div>

  {#if dragState.didDrag && draggedWorkspace}
    <button
      class="rail-button rail-button-workspace rail-button-workspace-ghost"
      type="button"
      aria-hidden="true"
      tabindex="-1"
      style={`left:${ghostLeft}px; top:${ghostTop}px; width:${dragState.dragWorkspaceRect?.width ?? 32}px; height:${dragState.dragWorkspaceRect?.height ?? 32}px;`}
    >
      <span class="rail-workspace-initial">{workspaceInitial(draggedWorkspace)}</span>
    </button>
  {/if}

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
    position: relative;
    width: var(--activity-rail-width);
    border-right: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-8) var(--space-6);
  }

  .activity-rail-dragging {
    user-select: none;
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

  .rail-workspace-placeholder {
    flex-shrink: 0;
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

  .rail-button-chat {
    padding: 0;
  }

  .rail-chat-icon {
    display: block;
  }

  .rail-button-workspace {
    font-weight: 600;
  }

  .rail-button-workspace-ghost {
    position: absolute;
    z-index: 2;
    pointer-events: none;
    cursor: grabbing;
    box-shadow: var(--shadow-overlay);
    border-color: var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
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
