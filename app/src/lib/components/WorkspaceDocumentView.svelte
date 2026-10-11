<script lang="ts">
  import { untrack } from "svelte";
  import EditorSurface from "./EditorSurface.svelte";
  import { renderDocumentMarkdown } from "../services/markdownImageSrc";
  import DOMPurify from "dompurify";
  import { getWorkspaceDocumentStorage, subscribeWorkspacePreferences } from "../services/workspacePreferences";
  import { workspaceDocumentsRevision, workspaceDocumentSnapshot, loadWorkspaceDocument, editWorkspaceDocument, saveWorkspaceDocument, reloadWorkspaceDocument, type WorkspaceDocumentKind } from "../services/workspaceDocuments";
  import { parseWorkspaceTasks, updateWorkspaceTask, reorderWorkspaceTask, appendWorkspaceTask } from "../services/workspaceTasks";
  import { requestConfirm } from "../services/confirmDialogUi";
  let { root, kind, paneId, contextId, notify }: { root: string; kind: WorkspaceDocumentKind; paneId: string; contextId: import("../domain/contracts").ContextId; notify: (message: string) => void } = $props();
  let mode = $state<"content" | "source">("content");
  let newTask = $state("");
  let storageRevision = $state(0);
  $effect(() => untrack(() => subscribeWorkspacePreferences(() => { storageRevision++; })));
  $effect(() => {
    const workspace = root; const documentKind = kind; void storageRevision;
    untrack(() => { void loadWorkspaceDocument(workspace, documentKind, getWorkspaceDocumentStorage(workspace), true).catch((error) => notify(String(error))); });
  });
  const record = $derived.by(() => { void $workspaceDocumentsRevision; void storageRevision; return workspaceDocumentSnapshot(root, kind); });
  // Service records are mutable; a fresh view snapshot propagates every revision.
  const recordView = $derived.by(() => { void $workspaceDocumentsRevision; return record ? { ...record } : null; });
  const content = $derived(recordView?.content ?? "");
  const tasks = $derived(parseWorkspaceTasks(content));
  const html = $derived(kind === "notes" && mode === "content" ? DOMPurify.sanitize(renderDocumentMarkdown(content, recordView?.path ?? null)) : "");
  function edit(next: string): void { if (record) editWorkspaceDocument(record, next); }
  async function resolveConflict(discard: boolean): Promise<void> {
    if (!record) return;
    if (!(await requestConfirm({ title: discard ? "Reload document" : "Replace disk contents", message: discard ? "Discard local edits and reload the file?" : "Replace the current file on disk with your local contents?", confirmLabel: discard ? "Reload" : "Replace", danger: true }))) return;
    try { await reloadWorkspaceDocument(record, discard); } catch (error) { notify(String(error)); }
  }
</script>
<svelte:window onfocus={() => { void loadWorkspaceDocument(root, kind, getWorkspaceDocumentStorage(root), true).catch((error) => notify(String(error))); }} />
<div class="workspace-document">
  <header>
    <strong>{kind === "tasks" ? "Tasks" : "Notes"}</strong>
    <button class="btn btn-sm btn-ghost" type="button" aria-pressed={mode === "content"} onclick={() => mode = "content"}>{kind === "tasks" ? "Todo list" : "Preview"}</button>
    <button class="btn btn-sm btn-ghost" type="button" aria-pressed={mode === "source"} onclick={() => mode = "source"}>Markdown</button>
    <small>{recordView?.saving || recordView?.content !== recordView?.saved ? "Saving…" : "Saved"}</small>
    <button class="btn btn-sm btn-ghost" type="button" onclick={() => { if (record) void saveWorkspaceDocument(record).catch((error) => notify(String(error))); }}>Save</button>
  </header>
  {#if recordView?.error}
    <div class="error" role="alert">{recordView.error}
      <button class="btn btn-sm" type="button" onclick={() => { void resolveConflict(true); }}>Reload disk contents</button>
      <button class="btn btn-sm" type="button" onclick={() => { void resolveConflict(false); }}>Keep local contents</button>
    </div>
  {/if}
  {#if !recordView || recordView.loading}<p>Loading…</p>
  {:else if recordView.content === null}<p>This document does not exist in the selected storage location. Create it from the workspace menu.</p>
  {:else if mode === "source"}
    <EditorSurface {content} documentId={`workspace-${kind}`} {paneId} {contextId} language="markdown" wrapLines={true} onDocumentDirty={edit} onStatusMessage={notify} />
  {:else if kind === "tasks"}
    <div class="tasks">
      {#each tasks as task, index (task.line)}
        <div class="task">
          <input type="checkbox" aria-label={`Complete ${task.text}`} checked={task.checked} onchange={(event) => edit(updateWorkspaceTask(content, task.line, undefined, event.currentTarget.checked))} />
          <input class:completed={task.checked} class="task-text" aria-label="Task text" value={task.text} onchange={(event) => edit(updateWorkspaceTask(content, task.line, event.currentTarget.value))} />
          <button type="button" class="btn btn-sm btn-ghost" aria-label="Move task up" disabled={index === 0} onclick={() => edit(reorderWorkspaceTask(content, task.line, -1))}>↑</button>
          <button type="button" class="btn btn-sm btn-ghost" aria-label="Move task down" disabled={index === tasks.length - 1} onclick={() => edit(reorderWorkspaceTask(content, task.line, 1))}>↓</button>
        </div>
      {/each}
      <form onsubmit={(event) => { event.preventDefault(); if (newTask.trim()) { edit(appendWorkspaceTask(content, newTask)); newTask = ""; } }}>
        <input aria-label="New task" placeholder="Add a task…" bind:value={newTask} />
        <button class="btn btn-sm" type="submit" disabled={!newTask.trim()}>Add</button>
      </form>
    </div>
  {:else}
    <div class="markdown-preview-body preview">{@html html}</div>
  {/if}
</div>
<style>
  .workspace-document { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--color-border-subtle); }
  small { margin-left: auto; color: var(--color-text-secondary); }
  .tasks, .preview { padding: 16px; overflow: auto; }
  .task, form { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
  .task-text, form input { flex: 1; min-width: 0; border: 1px solid var(--color-border-subtle); background: transparent; color: var(--color-text-primary); font: inherit; padding: 6px; }
  .completed { text-decoration: line-through; color: var(--color-text-secondary); }
  .error { color: var(--color-danger); padding: 12px; overflow-wrap: anywhere; }
</style>
