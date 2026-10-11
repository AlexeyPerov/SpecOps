<script lang="ts">
  import { untrack } from "svelte";
  import { appState } from "../state/appState";
  import { getWorkspaceDocumentStorage, subscribeWorkspacePreferences } from "../services/workspacePreferences";
  import { loadWorkspaceDocument, workspaceDocumentsRevision, workspaceDocumentSnapshot } from "../services/workspaceDocuments";
  let { root, refreshToken }: { root: string; refreshToken?: unknown } = $props();
  let preferenceRevision = $state(0);
  $effect(() => subscribeWorkspacePreferences(() => { preferenceRevision++; }));
  $effect(() => {
    const workspace = root; void refreshToken; void preferenceRevision;
    untrack(() => { for (const kind of ["tasks", "notes"] as const) void loadWorkspaceDocument(workspace, kind, getWorkspaceDocumentStorage(workspace), true).catch(() => {}); });
  });
  const documents = $derived.by(() => {
    void $workspaceDocumentsRevision; void preferenceRevision;
    return (["tasks", "notes"] as const).filter((kind) => workspaceDocumentSnapshot(root, kind)?.content !== null && workspaceDocumentSnapshot(root, kind)?.content !== undefined);
  });
</script>
{#if documents.length}
  <nav aria-label="Workspace documents">
    {#each documents as kind (kind)}
      <button type="button" onclick={() => { const workspace = appState.getSnapshot().contexts.workspaces.find((entry) => entry.rootPath === root); if (workspace) { appState.switchContext(workspace.id); appState.openOrFocusViewTab(kind === "tasks" ? "workspace-tasks" : "workspace-notes"); } }}>{kind === "tasks" ? "☑ Tasks" : "▤ Notes"}</button>
    {/each}
  </nav>
{/if}
<style>
  nav { padding: 4px; border-bottom: 1px solid var(--color-border-subtle); }
  button { display: block; width: 100%; border: 0; background: transparent; color: var(--color-text-primary); padding: 6px; text-align: left; font: inherit; cursor: pointer; }
  button:hover { background: var(--color-hover); }
</style>
