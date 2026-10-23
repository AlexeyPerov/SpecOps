import type { GlobalDocument, ProjectCatalog } from "../domain/projectCatalog";
import { appState } from "../state/appState";
import { getProjectCatalog, updateProjectCatalog } from "./workspaceCatalog";
import { discardGlobalDocument, type WorkspaceDocumentKind } from "./workspaceDocuments";

export const GLOBAL_DOCUMENT_KINDS: readonly WorkspaceDocumentKind[] = ["tasks", "notes"];

export function globalDocumentKindLabel(kind: WorkspaceDocumentKind): string {
  return kind === "tasks" ? "Tasks" : "Notes";
}

/** Documents of one kind in their sidebar order. */
export function globalDocumentsOfKind(catalog: ProjectCatalog, kind: WorkspaceDocumentKind): GlobalDocument[] {
  return Object.values(catalog.documents ?? {})
    .filter((document) => document.kind === kind)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function findGlobalDocument(id: string, catalog = getProjectCatalog()): GlobalDocument | null {
  return catalog.documents?.[id] ?? null;
}

/** First unused "Tasks", "Tasks 2", … name for a new document of `kind`. */
export function nextGlobalDocumentName(catalog: ProjectCatalog, kind: WorkspaceDocumentKind): string {
  const names = new Set(globalDocumentsOfKind(catalog, kind).map((document) => document.name));
  const base = globalDocumentKindLabel(kind);
  let name = base;
  for (let index = 2; names.has(name); index += 1) name = `${base} ${index}`;
  return name;
}

export async function createGlobalDocument(kind: WorkspaceDocumentKind, name?: string): Promise<GlobalDocument> {
  const document: GlobalDocument = {
    id: crypto.randomUUID(),
    kind,
    name: name?.trim() || nextGlobalDocumentName(getProjectCatalog(), kind),
    order: 0,
  };
  const catalog = await updateProjectCatalog([{ type: "putDocument", document }]);
  return catalog.documents[document.id] ?? document;
}

export async function renameGlobalDocument(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed || findGlobalDocument(id)?.name === trimmed) return;
  await updateProjectCatalog([{ type: "renameDocument", id, name: trimmed }]);
}

/** Moves the document one step up (-1) or down (+1) among documents of its kind. */
export async function moveGlobalDocument(id: string, delta: -1 | 1): Promise<void> {
  const document = findGlobalDocument(id);
  if (!document) return;
  const siblings = globalDocumentsOfKind(getProjectCatalog(), document.kind);
  const index = siblings.findIndex((entry) => entry.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= siblings.length) return;
  // `beforeId` names the sibling that should follow the moved document.
  const beforeId = delta < 0 ? siblings[target].id : siblings[target + 1]?.id ?? null;
  await updateProjectCatalog([{ type: "moveDocument", id, beforeId }]);
}

/**
 * Open (or focus) the document's tab in the active tab group; while a
 * workspace is active it opens in the window's last used tab group.
 */
export function openGlobalDocument(id: string): boolean {
  const document = findGlobalDocument(id);
  if (!document) return false;
  const groupId = appState.getTargetTabGroupId();
  appState.switchContext(groupId);
  if (appState.getSnapshot().contexts.activeContextId !== groupId) return false;
  appState.openOrFocusViewTab(document.kind === "tasks" ? "workspace-tasks" : "workspace-notes", undefined, id);
  return true;
}

/**
 * Removes the catalog entry and this window's tabs for it; the native
 * transaction then deletes the document's files. Other windows close their
 * tabs when the catalog change reaches them.
 */
export async function deleteGlobalDocument(id: string): Promise<void> {
  await discardGlobalDocument(id);
  await updateProjectCatalog([{ type: "removeDocument", id }]);
  appState.closeGlobalDocumentTabs(id);
}

/** Close tabs and drop cached buffers of documents another window deleted. */
export function pruneDeletedGlobalDocuments(catalog: ProjectCatalog): void {
  for (const group of [...appState.getSnapshot().contexts.tabGroups, ...appState.getSnapshot().contexts.workspaces]) {
    for (const pane of group.snapshot.session.editorLayout.panes) {
      for (const tab of pane.tabs) {
        if (tab.kind === "view" && tab.globalDocumentId && !catalog.documents?.[tab.globalDocumentId]) {
          appState.closeGlobalDocumentTabs(tab.globalDocumentId);
          void discardGlobalDocument(tab.globalDocumentId);
        }
      }
    }
  }
}
