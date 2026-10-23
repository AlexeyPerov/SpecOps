import { listen } from "@tauri-apps/api/event";
import { emptyTaskBook, parseTaskBook, serializeTaskBook } from "./workspaceTasks";
import { invoke } from "@tauri-apps/api/core";
import { writable } from "svelte/store";
import { normalizePathSync } from "./diskFingerprint";
import { getWorkspaceDocumentStorage, setWorkspaceDocumentStorage, type WorkspaceDocumentStorage } from "./workspacePreferences";
export type WorkspaceDocumentKind = "tasks" | "notes";
/** A workspace root, or an app-wide document from the catalog. */
export type DocumentScope = string | { documentId: string };
export interface WorkspaceDocumentRecord {
  root: string | null; documentId: string | null; storage: WorkspaceDocumentStorage; kind: WorkspaceDocumentKind;
  path: string; content: string | null; saved: string | null; error: string | null;
  conflict?: boolean;
  loading?: Promise<WorkspaceDocumentRecord>; saving?: Promise<void>; timer?: ReturnType<typeof setTimeout>;
}
const records = new Map<string, WorkspaceDocumentRecord>();
export const workspaceDocumentsRevision = writable(0);
function changed(): void { workspaceDocumentsRevision.update((revision) => revision + 1); }
export function documentStorage(scope: DocumentScope): WorkspaceDocumentStorage { return typeof scope === "string" ? getWorkspaceDocumentStorage(scope) : "app"; }
function scopeKey(scope: DocumentScope): string { return typeof scope === "string" ? `root:${normalizePathSync(scope)}` : `document:${scope.documentId}`; }
function recordScope(record: WorkspaceDocumentRecord): DocumentScope { return record.root ?? { documentId: record.documentId ?? "" }; }
function key(scope: DocumentScope, storage: string, kind: string): string { return JSON.stringify([scopeKey(scope), storage, kind]); }
function readArgs(record: Pick<WorkspaceDocumentRecord, "root" | "documentId" | "storage" | "kind">) {
  return { root: record.root, document: record.documentId, storage: record.storage, kind: record.kind };
}
let listening: Promise<unknown> | undefined;
function ensureDocumentEvents(): Promise<unknown> {
  return listening ??= listen<{ path: string }>("workspace-document-changed", ({ payload }) => {
    for (const record of records.values()) {
      if (record.path && normalizePathSync(record.path) === normalizePathSync(payload.path)) void refreshDocument(record).catch(() => {});
    }
  }).catch(() => { listening = undefined; });
}
/** Reload clean copies; keep dirty buffers and expose concurrent changes as conflicts. */
export async function refreshDocument(record: WorkspaceDocumentRecord): Promise<void> {
  if (record.loading) await record.loading;
  if (record.saving) await record.saving.catch(() => {});
  try {
    const expected = record.saved;
    const result = await invoke<{ path: string; content: string | null }>("workspace_document_read", readArgs(record));
    // A save completed while the read was outstanding; its next event will refresh us.
    if (record.saved !== expected || record.saving) return;
    record.path = result.path;
    if (record.content === record.saved) {
      record.content = result.content; record.saved = result.content; record.error = null; record.conflict = false;
    } else if (result.content !== record.saved) {
      if (record.timer) { clearTimeout(record.timer); record.timer = undefined; }
      record.conflict = true;
      record.error = "Document changed on disk. Reload or resolve the conflict before saving.";
    }
    changed();
  } catch (error) {
    record.error = String(error); changed(); throw error;
  }
}
export function workspaceDocumentSnapshot(scope: DocumentScope, kind: WorkspaceDocumentKind): WorkspaceDocumentRecord | null {
  return records.get(key(scope, documentStorage(scope), kind)) ?? null;
}
export async function loadWorkspaceDocument(scope: DocumentScope, kind: WorkspaceDocumentKind, storage = documentStorage(scope), reload = false): Promise<WorkspaceDocumentRecord> {
  await ensureDocumentEvents();
  const id = key(scope, storage, kind);
  let record = records.get(id);
  if (record?.loading) return record.loading;
  if (record && (!reload || record.content !== record.saved || record.saving)) return record;
  if (!record) {
    record = { root: typeof scope === "string" ? scope : null, documentId: typeof scope === "string" ? null : scope.documentId,
      kind, storage, path: "", content: null, saved: null, error: null };
    records.set(id, record);
  }
  const target = record;
  target.loading = (async () => {
    try {
      const expected = target.saved;
      const result = await invoke<{ path: string; content: string | null }>("workspace_document_read", readArgs(target));
      target.path = result.path;
      if (target.saved === expected && target.content === target.saved && !target.saving) { target.content = result.content; target.saved = result.content; target.error = null; target.conflict = false; }
      return target;
    } catch (error) { target.error = String(error); throw error; }
    finally { target.loading = undefined; changed(); }
  })();
  return target.loading;
}
export async function createWorkspaceDocument(scope: DocumentScope, kind: WorkspaceDocumentKind): Promise<void> {
  const record = await loadWorkspaceDocument(scope, kind, undefined, true);
  if (record.content !== null) return;
  record.content = kind === "tasks" ? serializeTaskBook(emptyTaskBook()) : "# Notes\n\n";
  changed();
  await saveWorkspaceDocument(record);
}
export function editWorkspaceDocument(record: WorkspaceDocumentRecord, content: string): void {
  if (record.kind === "tasks") parseTaskBook(content);
  record.content = content;
  changed();
  if (record.timer) clearTimeout(record.timer);
  record.timer = setTimeout(() => { record.timer = undefined; void saveWorkspaceDocument(record).catch(() => {}); }, 200);
}
export async function saveWorkspaceDocument(record: WorkspaceDocumentRecord): Promise<void> {
  if (record.timer) { clearTimeout(record.timer); record.timer = undefined; }
  if (record.saving) { await record.saving; if (record.content !== record.saved) await saveWorkspaceDocument(record); return; }
  if (record.conflict) throw new Error(record.error ?? "Resolve the document conflict before saving.");
  record.saving = (async () => {
    try {
      while (record.content !== null && record.content !== record.saved) {
        const content = record.content;
        if (record.kind === "tasks") parseTaskBook(content);
        await invoke("workspace_document_save", { ...readArgs(record), content, expected: record.saved });
        record.saved = content;
      }
      record.error = null;
    } catch (error) { record.error = String(error); if (/changed on disk/i.test(record.error)) record.conflict = true; throw error; }
    finally { changed(); }
  })();
  try { await record.saving; } finally { record.saving = undefined; changed(); }
}
export async function flushWorkspaceDocuments(root?: string): Promise<void> {
  for (const record of records.values()) {
    if (!root || scopeKey(root) === scopeKey(recordScope(record))) {
      if (record.loading) await record.loading;
      await saveWorkspaceDocument(record);
    }
  }
}
/** A separate explicit operation; selecting a location alone never copies or removes data. */
export async function transferWorkspaceDocuments(root: string, target: WorkspaceDocumentStorage, replace: boolean): Promise<string | null> {
  const source = getWorkspaceDocumentStorage(root);
  await flushWorkspaceDocuments(root);
  const warning = await invoke<string | null>("workspace_documents_transfer", { root, source, target, replace });
  await setWorkspaceDocumentStorage(root, target);
  for (const kind of ["tasks", "notes"] as const) {
    records.delete(key(root, source, kind)); records.delete(key(root, target, kind));
    await loadWorkspaceDocument(root, kind);
  }
  changed();
  return warning;
}
export async function reloadWorkspaceDocument(record: WorkspaceDocumentRecord, discard: boolean): Promise<void> {
  if (record.saving) await record.saving.catch(() => {});
  const result = await invoke<{ path: string; content: string | null }>("workspace_document_read", readArgs(record));
  if (record.timer) { clearTimeout(record.timer); record.timer = undefined; }
  record.saved = result.content; record.path = result.path;
  if (discard) record.content = result.content;
  record.error = null; record.conflict = false; changed();
  if (!discard) await saveWorkspaceDocument(record);
}

/**
 * Forget an app-wide document after its catalog entry is deleted. Pending
 * edits are dropped: the document no longer exists.
 */
export async function discardGlobalDocument(documentId: string): Promise<void> {
  for (const [id, record] of records) {
    if (record.documentId !== documentId) continue;
    if (record.timer) clearTimeout(record.timer);
    records.delete(id);
    // An in-flight write must land before the files are deleted.
    await record.saving?.catch(() => {});
  }
  changed();
}

/** Release only fully settled records; a flush failure must keep the live buffer. */
export function releaseWorkspaceDocuments(root: string): void {
  for (const [id, record] of records) {
    if (scopeKey(recordScope(record)) !== scopeKey(root) || record.loading || record.saving || record.content !== record.saved) continue;
    if (record.timer) clearTimeout(record.timer);
    records.delete(id);
  }
  changed();
}

export function workspaceDocumentsSettled(root: string): boolean {
  return [...records.values()].filter(record => scopeKey(recordScope(record)) === scopeKey(root))
    .every(record => !record.loading && !record.saving && record.content === record.saved);
}
