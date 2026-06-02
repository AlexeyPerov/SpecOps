import type {
  AppDomainState,
  ContextId,
  ContextSnapshot,
  DocumentState,
  SessionState,
  WorkspaceEntry,
} from "../../domain/contracts";
import { isFileTab } from "../../domain/contracts";
import { normalizePathSync } from "../../services/diskFingerprint";
import { normalizeDocument } from "./documentHelpers";

export const NOTEPAD_CONTEXT_ID: ContextId = "notepad";

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
      ...contexts.workspaces.flatMap((workspace) => workspace.snapshot.documents),
    ].map((documentState) => Number(documentState.id.replace("doc-", "")) || 1),
  );
  idCounters.tab = Math.max(
    1,
    ...[
      ...contexts.notepad.session.openTabs,
      ...contexts.workspaces.flatMap((workspace) => workspace.snapshot.session.openTabs),
    ].map((tab) => Number(tab.id.replace("tab-", "")) || 1),
  );
  reindexWorkspaceCounter(contexts.workspaces);
}

export function cloneContextSnapshot(snapshot: ContextSnapshot): ContextSnapshot {
  return {
    documents: snapshot.documents.map(normalizeDocument),
    session: {
      ...snapshot.session,
      openTabs: snapshot.session.openTabs.map((tab) => ({ ...tab })),
      windowBounds: snapshot.session.windowBounds ?? null,
    },
  };
}

export function normalizeWorkspaceEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    rootPath: normalizePathSync(entry.rootPath),
    snapshot: cloneContextSnapshot(entry.snapshot),
  }));
}

export function getContextSnapshotById(state: AppDomainState, contextId: ContextId): ContextSnapshot | null {
  if (contextId === NOTEPAD_CONTEXT_ID) {
    return state.contexts.notepad;
  }
  const workspace = state.contexts.workspaces.find((entry) => entry.id === contextId);
  return workspace?.snapshot ?? null;
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
  for (const tab of context.session.openTabs) {
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
