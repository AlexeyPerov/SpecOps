import { invoke } from "@tauri-apps/api/core";
import { writable } from "svelte/store";
import { normalizePathSync } from "./diskFingerprint";
import { getWorkspaceDocumentStorage, setWorkspaceDocumentStorage, type WorkspaceDocumentStorage } from "./workspacePreferences";
export type WorkspaceDocumentKind = "tasks" | "notes";
export interface WorkspaceDocumentRecord {
  root: string; storage: WorkspaceDocumentStorage; kind: WorkspaceDocumentKind;
  path: string; content: string | null; saved: string | null; error: string | null;
  loading?: Promise<WorkspaceDocumentRecord>; saving?: Promise<void>; timer?: ReturnType<typeof setTimeout>;
}
const records = new Map<string, WorkspaceDocumentRecord>();
export const workspaceDocumentsRevision = writable(0);
function changed(): void { workspaceDocumentsRevision.update((revision) => revision + 1); }
function key(root: string, storage: string, kind: string): string { return JSON.stringify([normalizePathSync(root), storage, kind]); }
export function workspaceDocumentSnapshot(root: string, kind: WorkspaceDocumentKind): WorkspaceDocumentRecord | null {
  return records.get(key(root, getWorkspaceDocumentStorage(root), kind)) ?? null;
}
export async function loadWorkspaceDocument(root: string, kind: WorkspaceDocumentKind, storage = getWorkspaceDocumentStorage(root), reload = false): Promise<WorkspaceDocumentRecord> {
  const id = key(root, storage, kind);
  let record = records.get(id);
  if (record?.loading) return record.loading;
  if (record && (!reload || record.content !== record.saved || record.saving)) return record;
  if (!record) { record = { root, kind, storage, path: "", content: null, saved: null, error: null }; records.set(id, record); }
  const target = record;
  target.loading = (async () => {
    try {
      const result = await invoke<{ path: string; content: string | null }>("workspace_document_read", { root, storage, kind });
      target.path = result.path; target.content = result.content; target.saved = result.content; target.error = null;
      return target;
    } catch (error) { target.error = String(error); throw error; }
    finally { target.loading = undefined; changed(); }
  })();
  return target.loading;
}
export async function createWorkspaceDocument(root: string, kind: WorkspaceDocumentKind): Promise<void> {
  const record = await loadWorkspaceDocument(root, kind, undefined, true);
  if (record.content !== null) return;
  record.content = kind === "tasks" ? "# Tasks\n\n" : "# Notes\n\n";
  changed();
  await saveWorkspaceDocument(record);
}
export function editWorkspaceDocument(record: WorkspaceDocumentRecord, content: string): void {
  record.content = content;
  changed();
  if (record.timer) clearTimeout(record.timer);
  record.timer = setTimeout(() => { record.timer = undefined; void saveWorkspaceDocument(record).catch(() => {}); }, 200);
}
export async function saveWorkspaceDocument(record: WorkspaceDocumentRecord): Promise<void> {
  if (record.timer) { clearTimeout(record.timer); record.timer = undefined; }
  if (record.saving) { await record.saving; if (record.content !== record.saved) await saveWorkspaceDocument(record); return; }
  record.saving = (async () => {
    try {
      while (record.content !== null && record.content !== record.saved) {
        const content = record.content;
        await invoke("workspace_document_save", { root: record.root, storage: record.storage, kind: record.kind, content, expected: record.saved });
        record.saved = content;
      }
      record.error = null;
    } catch (error) { record.error = String(error); throw error; }
    finally { changed(); }
  })();
  try { await record.saving; } finally { record.saving = undefined; changed(); }
}
export async function flushWorkspaceDocuments(root?: string): Promise<void> {
  for (const record of records.values()) {
    if (!root || normalizePathSync(root) === normalizePathSync(record.root)) {
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
  const result = await invoke<{ path: string; content: string | null }>("workspace_document_read", { root: record.root, storage: record.storage, kind: record.kind });
  if (record.timer) { clearTimeout(record.timer); record.timer = undefined; }
  record.saved = result.content; record.path = result.path;
  if (discard) record.content = result.content;
  record.error = null; changed();
  if (!discard) await saveWorkspaceDocument(record);
}

/** Release only fully settled records; a flush failure must keep the live buffer. */
export function releaseWorkspaceDocuments(root: string): void {
  for (const [id, record] of records) {
    if (normalizePathSync(record.root) !== normalizePathSync(root) || record.loading || record.saving || record.content !== record.saved) continue;
    if (record.timer) clearTimeout(record.timer);
    records.delete(id);
  }
  changed();
}

export function workspaceDocumentsSettled(root: string): boolean {
  return [...records.values()].filter(record => normalizePathSync(record.root) === normalizePathSync(root))
    .every(record => !record.loading && !record.saving && record.content === record.saved);
}
