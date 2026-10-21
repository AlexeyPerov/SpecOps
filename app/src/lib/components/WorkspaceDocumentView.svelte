<script lang="ts">
  import { untrack } from "svelte";
  import EditorSurface from "./EditorSurface.svelte";
  import { renderDocumentMarkdown } from "../services/markdownImageSrc";
  import DOMPurify from "dompurify";
  import { subscribeWorkspacePreferences } from "../services/workspacePreferences";
  import { documentStorage, refreshDocument, workspaceDocumentsRevision, workspaceDocumentSnapshot, loadWorkspaceDocument, editWorkspaceDocument, saveWorkspaceDocument, reloadWorkspaceDocument, type WorkspaceDocumentKind } from "../services/workspaceDocuments";
  import { emptyTaskBook, serializeTaskBook } from "../services/workspaceTasks";
  import TaskBookView from "./TaskBookView.svelte";
  import { requestConfirm } from "../services/confirmDialogUi";
  let { root, kind, paneId, contextId, notify }: { root: string | null; kind: WorkspaceDocumentKind; paneId: string; contextId: import("../domain/contracts").ContextId; notify: (message: string) => void } = $props();
  let mode = $state<"content" | "source" | null>(null);
  let storageRevision = $state(0);
  $effect(() => {
    const workspace = root;
    let selectedStorage = documentStorage(workspace);
    return untrack(() => subscribeWorkspacePreferences(() => {
      const next = documentStorage(workspace);
      if (next !== selectedStorage) { selectedStorage = next; storageRevision++; }
    }));
  });
  $effect(() => {
    const workspace = root; const documentKind = kind; void storageRevision;
    untrack(() => { void loadWorkspaceDocument(workspace, documentKind, documentStorage(workspace), true).catch((error) => notify(String(error))); });
  });
  const record = $derived.by(() => { void $workspaceDocumentsRevision; void storageRevision; return workspaceDocumentSnapshot(root, kind); });
  // Service records are mutable; a fresh view snapshot propagates every revision.
  const recordView = $derived.by(() => { void $workspaceDocumentsRevision; return record ? { ...record } : null; });
  const content = $derived(recordView?.content ?? (kind === "tasks" ? serializeTaskBook(emptyTaskBook()) : ""));
  const displayMode = $derived(mode ?? (recordView?.content === null ? "source" : "content"));
  const html = $derived(kind === "notes" && displayMode === "content" ? DOMPurify.sanitize(renderDocumentMarkdown(content, recordView?.path ?? null)) : "");
  function edit(next: string): void {
    if (!record || next === content) return;
    if (kind === "notes" && record.content === null) mode = "source";
    editWorkspaceDocument(record, next);
  }
  function refresh(): void { if (record) void refreshDocument(record).catch((error) => notify(String(error))); }
  async function resolveConflict(discard: boolean): Promise<void> {
    if (!record) return;
    if (!(await requestConfirm({ title: discard ? "Reload document" : "Replace disk contents", message: discard ? "Discard local edits and reload the file?" : "Replace the current file on disk with your local contents?", confirmLabel: discard ? "Reload" : "Replace", danger: true }))) return;
    try { await reloadWorkspaceDocument(record, discard); } catch (error) { notify(String(error)); }
  }
</script>
<svelte:window onfocus={refresh} />
<div class="workspace-document">
  <header>
    <strong title={root ?? "Shared across all windows"}>{root === null ? "" : "Workspace "}{kind === "tasks" ? "Tasks" : "Notes"}</strong>
    {#if kind === "notes"}
      <button class="btn btn-sm btn-ghost" type="button" aria-pressed={displayMode === "content"} onclick={() => mode = "content"}>Preview</button>
      <button class="btn btn-sm btn-ghost" type="button" aria-pressed={displayMode === "source"} onclick={() => mode = "source"}>Edit</button>
    {/if}
    <small>{recordView?.error ? "Not saved" : recordView?.loading ? "Loading…" : recordView?.saving || recordView?.content !== recordView?.saved ? "Saving…" : recordView?.content === null ? "Empty" : "Saved"}</small>
    <button class="btn btn-sm btn-ghost" type="button" onclick={refresh}>Refresh</button>
    <button class="btn btn-sm btn-ghost" type="button" onclick={() => { if (record) void saveWorkspaceDocument(record).catch((error) => notify(String(error))); }}>Save</button>
  </header>
  {#if recordView?.error}
    <div class="error" role="alert">{recordView.error}
      <button class="btn btn-sm" type="button" onclick={() => { void resolveConflict(true); }}>Reload disk contents</button>
      <button class="btn btn-sm" type="button" onclick={() => { void resolveConflict(false); }}>Keep local contents</button>
    </div>
  {/if}
  {#if !recordView || (recordView.loading && !recordView.path)}<p>Loading…</p>
  {:else if kind === "notes" && displayMode === "source"}
    <EditorSurface {content} documentId={`workspace-${kind}`} {paneId} {contextId} language="markdown" wrapLines={true} onDocumentDirty={edit} onStatusMessage={notify} />
  {:else if kind === "tasks"}
    {#key recordView.path}<TaskBookView {content} onchange={edit} {notify} />{/key}
  {:else}
    <div class="markdown-preview-body preview">{@html html}</div>
  {/if}
</div>
<style>
  .workspace-document { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--color-border-subtle); }
  small { margin-left: auto; color: var(--color-text-secondary); }
  .preview { padding: 16px; overflow: auto; }
  .error { color: var(--color-danger); padding: 12px; overflow-wrap: anywhere; }
</style>
