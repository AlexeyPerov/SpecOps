<script lang="ts">
  import { untrack } from "svelte";
  import EditorSurface from "./EditorSurface.svelte";
  import { renderDocumentMarkdown } from "../services/markdownImageSrc";
  import DOMPurify from "dompurify";
  import { subscribeWorkspacePreferences } from "../services/workspacePreferences";
  import { documentStorage, refreshDocument, workspaceDocumentsRevision, workspaceDocumentSnapshot, loadWorkspaceDocument, editWorkspaceDocument, saveWorkspaceDocument, reloadWorkspaceDocument, type DocumentScope, type WorkspaceDocumentKind } from "../services/workspaceDocuments";
  import { getProjectCatalog, subscribeProjectCatalog } from "../services/workspaceCatalog";
  import { emptyTaskBook, serializeTaskBook } from "../services/workspaceTasks";
  import TaskBookView from "./TaskBookView.svelte";
  import { requestConfirm } from "../services/confirmDialogUi";
  import { anchorFromEvent, type PromptAnchor } from "../services/promptAnchor";
  let { root, documentId = null, kind, paneId, contextId, notify }: { root: string | null; documentId?: string | null; kind: WorkspaceDocumentKind; paneId: string; contextId: import("../domain/contracts").ContextId; notify: (message: string) => void } = $props();
  // Workspace documents are scoped by root; app-wide ones by their catalog id.
  const scope = $derived<DocumentScope | null>(root ?? (documentId ? { documentId } : null));
  let catalog = $state.raw(getProjectCatalog());
  $effect(() => untrack(() => subscribeProjectCatalog((next) => { catalog = next; })));
  const globalDocument = $derived(documentId ? catalog.documents?.[documentId] ?? null : null);
  // A deleted document must not be recreated by loading or saving it again.
  const deleted = $derived(root === null && !globalDocument);
  let mode = $state<"content" | "source">("source");
  let storageRevision = $state(0);
  $effect(() => {
    const target = scope;
    if (!target) return;
    let selectedStorage = documentStorage(target);
    return untrack(() => subscribeWorkspacePreferences(() => {
      const next = documentStorage(target);
      if (next !== selectedStorage) { selectedStorage = next; storageRevision++; }
    }));
  });
  $effect(() => {
    const target = scope; const documentKind = kind; void storageRevision;
    if (!target || deleted) return;
    untrack(() => { void loadWorkspaceDocument(target, documentKind, documentStorage(target), true).catch((error) => notify(String(error))); });
  });
  const record = $derived.by(() => { void $workspaceDocumentsRevision; void storageRevision; return scope && !deleted ? workspaceDocumentSnapshot(scope, kind) : null; });
  // Service records are mutable; a fresh view snapshot propagates every revision.
  const recordView = $derived.by(() => { void $workspaceDocumentsRevision; return record ? { ...record } : null; });
  const content = $derived(recordView?.content ?? (kind === "tasks" ? serializeTaskBook(emptyTaskBook()) : ""));
  const html = $derived(kind === "notes" && mode === "content" ? DOMPurify.sanitize(renderDocumentMarkdown(content, recordView?.path ?? null, { breaks: true })) : "");
  function edit(next: string): void {
    if (!record || next === content) return;
    editWorkspaceDocument(record, next);
  }
  function refresh(): void { if (record) void refreshDocument(record).catch((error) => notify(String(error))); }
  async function resolveConflict(discard: boolean, anchor?: PromptAnchor): Promise<void> {
    if (!record) return;
    if (!(await requestConfirm({ title: discard ? "Reload document" : "Replace disk contents", message: discard ? "Discard local edits and reload the file?" : "Replace the current file on disk with your local contents?", confirmLabel: discard ? "Reload" : "Replace", danger: true, anchor }))) return;
    try { await reloadWorkspaceDocument(record, discard); } catch (error) { notify(String(error)); }
  }
</script>
<svelte:window onfocus={refresh} />
<div class="workspace-document">
  <header>
    <strong title={root ?? "Shared across all windows"}>{root === null ? globalDocument?.name ?? (kind === "tasks" ? "Tasks" : "Notes") : `Workspace ${kind === "tasks" ? "Tasks" : "Notes"}`}</strong>
    {#if kind === "notes"}
      <button class="btn btn-sm btn-ghost" type="button" aria-pressed={mode === "content"} onclick={() => mode = "content"}>Preview</button>
      <button class="btn btn-sm btn-ghost" type="button" aria-pressed={mode === "source"} onclick={() => mode = "source"}>Edit</button>
    {/if}
    <small>{recordView?.error ? "Not saved" : recordView?.loading ? "Loading…" : recordView?.saving || recordView?.content !== recordView?.saved ? "Saving…" : recordView?.content === null ? "Empty" : "Saved"}</small>
    <button class="btn btn-sm btn-ghost" type="button" onclick={refresh}>Refresh</button>
    <button class="btn btn-sm btn-ghost" type="button" onclick={() => { if (record) void saveWorkspaceDocument(record).catch((error) => notify(String(error))); }}>Save</button>
  </header>
  {#if recordView?.error}
    <div class="error" role="alert">{recordView.error}
      <button class="btn btn-sm" type="button" onclick={(event) => { void resolveConflict(true, anchorFromEvent(event)); }}>Reload disk contents</button>
      <button class="btn btn-sm" type="button" onclick={(event) => { void resolveConflict(false, anchorFromEvent(event)); }}>Keep local contents</button>
    </div>
  {/if}
  {#if deleted}<p class="deleted" role="status">This document was deleted.</p>
  {:else if !recordView || (recordView.loading && !recordView.path)}<p>Loading…</p>
  {:else if kind === "notes" && mode === "source"}
    <EditorSurface {content} documentId={documentId ? `global-document-${documentId}` : `workspace-${kind}`} {paneId} {contextId} language="markdown" wrapLines={true} onDocumentDirty={edit} onStatusMessage={notify} />
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
  .deleted { padding: 12px; color: var(--color-text-secondary); }
</style>
