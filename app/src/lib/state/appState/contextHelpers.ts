import type {
  AppDomainState,
  ContextId,
  ContextSnapshot,
  DocumentState,
  SessionState,
  WorkspaceEntry,
} from "../../domain/contracts";
import {
  CHAT_HTTP_CONTEXT_ID,
  allTabs,
  isFileTab,
} from "../../domain/contracts";
import { normalizePathSync } from "../../services/diskFingerprint";
import { normalizeDocument } from "./documentHelpers";

export const NOTEPAD_CONTEXT_ID: ContextId = "notepad";
export const CHAT_HTTP_CONTEXT_KEY: ContextId = CHAT_HTTP_CONTEXT_ID;

const idCounters = {
  doc: 1,
  tab: 1,
  workspace: 0,
};

export function resetIdCounters(): void {
  idCounters.doc = 1;
  idCounters.tab = 1;
  idCounters.workspace = 0;
}

export function nextDocId(): string {
  idCounters.doc += 1;
  return `doc-${idCounters.doc}`;
}

export function nextTabId(): string {
  idCounters.tab += 1;
  return `tab-${idCounters.tab}`;
}

export function nextDocAndTabIds(): { docId: string; tabId: string } {
  idCounters.doc += 1;
  idCounters.tab += 1;
  return {
    docId: `doc-${idCounters.doc}`,
    tabId: `tab-${idCounters.tab}`,
  };
}

export function reindexWorkspaceCounter(workspaces: WorkspaceEntry[]): void {
  idCounters.workspace = Math.max(
    0,
    ...workspaces.map((workspace) => Number(workspace.id.replace("ws-", "")) || 0),
  );
}

export function nextWorkspaceId(): ContextId {
  idCounters.workspace += 1;
  return `ws-${idCounters.workspace}`;
}

export function reindexIdCountersFromContexts(contexts: AppDomainState["contexts"]): void {
  idCounters.doc = Math.max(
    1,
    ...[
      ...contexts.notepad.documents,
      ...contexts.chatHttp.documents,
      ...contexts.workspaces.flatMap((workspace) => workspace.snapshot.documents),
    ].map((documentState) => Number(documentState.id.replace("doc-", "")) || 1),
  );
  idCounters.tab = Math.max(
    1,
    ...[
      ...allTabs(contexts.notepad.session.editorLayout),
      ...allTabs(contexts.chatHttp.session.editorLayout),
      ...contexts.workspaces.flatMap((workspace) =>
        allTabs(workspace.snapshot.session.editorLayout),
      ),
    ].map((tab) => Number(tab.id.replace("tab-", "")) || 1),
  );
  reindexWorkspaceCounter(contexts.workspaces);
}

export function cloneContextSnapshot(snapshot: ContextSnapshot): ContextSnapshot {
  return {
    documents: snapshot.documents.map(normalizeDocument),
    session: {
      ...snapshot.session,
      editorLayout: cloneEditorLayout(snapshot.session.editorLayout),
      windowBounds: snapshot.session.windowBounds ?? null,
    },
  };
}

function cloneEditorLayout(layout: ContextSnapshot["session"]["editorLayout"]): ContextSnapshot["session"]["editorLayout"] {
  return {
    kind: layout.kind,
    activePaneId: layout.activePaneId,
    slots: layout.slots.map((row) => [...row]),
    panes: layout.panes.map((pane) => ({
      id: pane.id,
      tabs: pane.tabs.map((tab) => ({ ...tab })),
      selectedTabId: pane.selectedTabId,
    })),
  };
}

export function normalizeWorkspaceEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    rootPath: normalizePathSync(entry.rootPath),
    snapshot: cloneContextSnapshot(entry.snapshot),
  }));
}

/**
 * Per-state lookup cache for workspace context snapshots. The state object is
 * replaced on every mutation (immutable updates), so keying the cache by the
 * state reference via WeakMap auto-invalidates it when state changes. Within a
 * single state revision, repeated `getContextSnapshotById` calls for the same
 * contextId are O(1) instead of a linear scan over `workspaces`.
 *
 * `getContextSnapshotById` is called from many hot paths (cursor moves, tab
 * lookups, pane queries) several times per tick; the linear `workspaces.find`
 * dominated the cost for users with many workspaces open.
 */
const contextSnapshotCache = new WeakMap<AppDomainState, Map<ContextId, ContextSnapshot | null>>();

export function getContextSnapshotById(
  state: AppDomainState,
  contextId: ContextId,
): ContextSnapshot | null {
  if (contextId === NOTEPAD_CONTEXT_ID) {
    return state.contexts.notepad;
  }
  if (contextId === CHAT_HTTP_CONTEXT_KEY) {
    return state.contexts.chatHttp;
  }
  let cache = contextSnapshotCache.get(state);
  if (cache) {
    const cached = cache.get(contextId);
    if (cached !== undefined) {
      return cached;
    }
  }
  const workspace = state.contexts.workspaces.find((entry) => entry.id === contextId);
  const snapshot = workspace?.snapshot ?? null;
  if (!cache) {
    cache = new Map();
    contextSnapshotCache.set(state, cache);
  }
  cache.set(contextId, snapshot);
  return snapshot;
}

export function isChatHttpContext(contextId: ContextId): boolean {
  return contextId === CHAT_HTTP_CONTEXT_KEY;
}

export function getChatHttpContextSnapshot(state: AppDomainState): ContextSnapshot {
  return state.contexts.chatHttp;
}

export function getActiveContextSnapshot(state: AppDomainState): ContextSnapshot {
  return getContextSnapshotById(state, state.contexts.activeContextId) ?? state.contexts.notepad;
}

export function getActiveDocuments(state: AppDomainState): DocumentState[] {
  return getActiveContextSnapshot(state).documents;
}

export function getActiveSession(state: AppDomainState): SessionState {
  return getActiveContextSnapshot(state).session;
}

export function patchActiveContext(
  state: AppDomainState,
  patch: (snapshot: ContextSnapshot) => ContextSnapshot,
): AppDomainState {
  const contextId = state.contexts.activeContextId;
  const current = getContextSnapshotById(state, contextId) ?? state.contexts.notepad;
  const nextSnapshot = patch(current);
  if (nextSnapshot === current) {
    return state;
  }
  if (contextId === NOTEPAD_CONTEXT_ID) {
    return {
      ...state,
      contexts: {
        ...state.contexts,
        notepad: nextSnapshot,
      },
    };
  }
  if (isChatHttpContext(contextId)) {
    return {
      ...state,
      contexts: {
        ...state.contexts,
        chatHttp: nextSnapshot,
      },
    };
  }
  return {
    ...state,
    contexts: {
      ...state.contexts,
      workspaces: state.contexts.workspaces.map((workspace) =>
        workspace.id === contextId ? { ...workspace, snapshot: nextSnapshot } : workspace,
      ),
    },
  };
}

export function findWorkspaceByPath(
  workspaces: WorkspaceEntry[],
  rootPath: string,
): WorkspaceEntry | null {
  const normalized = normalizePathSync(rootPath);
  return workspaces.find((workspace) => normalizePathSync(workspace.rootPath) === normalized) ?? null;
}

export function findDocumentByPath(state: AppDomainState, filePath: string): DocumentState | undefined {
  const normalized = normalizePathSync(filePath);
  return getActiveDocuments(state).find(
    (documentState) =>
      documentState.filePath !== null &&
      normalizePathSync(documentState.filePath) === normalized,
  );
}

export function findDocumentByPathInContext(
  context: ContextSnapshot,
  filePath: string,
): DocumentState | undefined {
  const normalized = normalizePathSync(filePath);
  return context.documents.find(
    (documentState) =>
      documentState.filePath !== null &&
      normalizePathSync(documentState.filePath) === normalized,
  );
}

export function patchContextById(
  state: AppDomainState,
  contextId: ContextId,
  patch: (snapshot: ContextSnapshot) => ContextSnapshot,
): AppDomainState {
  const current = getContextSnapshotById(state, contextId);
  if (!current) {
    return state;
  }
  const nextSnapshot = patch(current);
  if (nextSnapshot === current) {
    return state;
  }
  if (contextId === NOTEPAD_CONTEXT_ID) {
    return {
      ...state,
      contexts: {
        ...state.contexts,
        notepad: nextSnapshot,
      },
    };
  }
  if (isChatHttpContext(contextId)) {
    return {
      ...state,
      contexts: {
        ...state.contexts,
        chatHttp: nextSnapshot,
      },
    };
  }
  return {
    ...state,
    contexts: {
      ...state.contexts,
      workspaces: state.contexts.workspaces.map((workspace) =>
        workspace.id === contextId ? { ...workspace, snapshot: nextSnapshot } : workspace,
      ),
    },
  };
}

export function findFileTabForNormalizedPath(
  context: ContextSnapshot,
  normalizedPath: string,
): { tabId: string; documentId: string; document: DocumentState } | null {
  for (const tab of allTabs(context.session.editorLayout)) {
    if (!isFileTab(tab)) {
      continue;
    }
    const documentState = context.documents.find((doc) => doc.id === tab.documentId);
    if (
      documentState?.filePath &&
      normalizePathSync(documentState.filePath) === normalizedPath
    ) {
      return { tabId: tab.id, documentId: documentState.id, document: documentState };
    }
  }
  return null;
}

/**
 * Enumerates every context snapshot in a stable order: active context first
 * (so first-match lookups prefer it), then notepad, chat-http, and finally the
 * remaining workspaces. Used by the cross-context document discovery helpers
 * so file side effects (watcher checks, reload prompts, relocation, Replace All
 * sync) can find a document that lives in a workspace which is not active.
 */
export interface ContextEntry {
  id: ContextId;
  snapshot: ContextSnapshot;
}

export function allContextSnapshots(state: AppDomainState): ContextEntry[] {
  const { contexts } = state;
  const entries: ContextEntry[] = [];
  const seen = new Set<ContextId>();
  const push = (id: ContextId, snapshot: ContextSnapshot): void => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    entries.push({ id, snapshot });
  };
  push(contexts.activeContextId, getContextSnapshotById(state, contexts.activeContextId) ?? contexts.notepad);
  push(NOTEPAD_CONTEXT_ID, contexts.notepad);
  if (!isChatHttpContext(contexts.activeContextId)) {
    push(CHAT_HTTP_CONTEXT_KEY, contexts.chatHttp);
  }
  for (const workspace of contexts.workspaces) {
    push(workspace.id, workspace.snapshot);
  }
  return entries;
}

/** Document ids across notepad, chat-http, and every workspace (for session-cache retain). */
export function collectAllOpenDocumentIds(state: AppDomainState): Set<string> {
  const ids = new Set<string>();
  for (const entry of allContextSnapshots(state)) {
    for (const documentState of entry.snapshot.documents) {
      ids.add(documentState.id);
    }
  }
  return ids;
}

/**
 * Find a document by id across every context. Returns the owning context id
 * together with the document, because document ids are not guaranteed to be
 * globally unique (a restore can seed the same id into more than one context),
 * so callers must target mutations at the returned context rather than the id
 * alone. Search order prefers the active context via {@link allContextSnapshots}.
 */
export function findDocumentContext(
  state: AppDomainState,
  documentId: string,
): { contextId: ContextId; document: DocumentState } | null {
  for (const entry of allContextSnapshots(state)) {
    const document = entry.snapshot.documents.find((doc) => doc.id === documentId);
    if (document) {
      return { contextId: entry.id, document };
    }
  }
  return null;
}

/**
 * Find an open file tab + document by normalized path across every context
 * (notepad, chat-http, and all workspaces). Returns the owning context id,
 * the document, and its tab id so side-effect flows can target the correct
 * workspace without requiring it to be the active context.
 */
export function findDocumentByNormalizedPathAllContexts(
  state: AppDomainState,
  normalizedPath: string,
): { contextId: ContextId; documentId: string; tabId: string; document: DocumentState } | null {
  for (const entry of allContextSnapshots(state)) {
    const match = findFileTabForNormalizedPath(entry.snapshot, normalizedPath);
    if (match) {
      return {
        contextId: entry.id,
        documentId: match.documentId,
        tabId: match.tabId,
        document: match.document,
      };
    }
  }
  return null;
}
