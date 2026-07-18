/**
 * Route/window-scoped editor workbench runtime.
 * Owns pane-aware host registration; never holds module-global state.
 */
import type {
  EditorCommandRunner,
  EditorHost,
  EditorHostIdentity,
  EditorHostRegistration,
} from "../types/editor";
import type { ContextId } from "../domain/contracts";
import { editorHostToCommandRunner } from "./editorHostFactory";

export type EditorCursorStatus = {
  identity: EditorHostIdentity;
  line: number;
  column: number;
  /** Number of active selection ranges (1 for single cursor; >1 for multi-cursor). */
  selectionCount: number;
};

export type EditorWorkbenchRuntimeDeps = {
  getActiveContextId: () => ContextId;
  getActivePaneId: () => string;
  getActiveDocumentId: () => string | null;
};

/**
 * Composite outer-map key for the host registry. Pane ids are context-local
 * (two restored workspaces can both have `pane-1`), so the contextId namespaces
 * them — this is what lets multiple contexts' editor trees stay mounted across
 * a context switch without their hosts colliding.
 */
function paneKey(contextId: ContextId, paneId: string): string {
  return `${contextId}:${paneId}`;
}

type HostEntry = {
  identity: EditorHostIdentity;
  host: EditorHost;
};

export type EditorWorkbenchRuntime = {
  registerHost: (host: EditorHost) => EditorHostRegistration;
  getActiveHost: () => EditorHost | null;
  /** Flat runner facade for the active host (command handlers / find panel). */
  getActiveRunner: () => EditorCommandRunner | null;
  publishCursorStatus: (
    identity: EditorHostIdentity,
    line: number,
    column: number,
    selectionCount: number,
  ) => void;
  subscribeCursorStatus: (listener: (status: EditorCursorStatus) => void) => () => void;
  focusActive: () => void;
  /** Drop all registrations (window/route teardown). */
  dispose: () => void;
};

function identitiesEqual(a: EditorHostIdentity, b: EditorHostIdentity): boolean {
  return (
    a.paneId === b.paneId &&
    a.documentId === b.documentId &&
    a.generation === b.generation
  );
}

export function createEditorWorkbenchRuntime(
  deps: EditorWorkbenchRuntimeDeps,
): EditorWorkbenchRuntime {
  // Hosts are keyed by ((contextId, paneId), documentId). A pane may hold
  // several live hosts at once when the editor surface keeps multiple document
  // tabs mounted (tab keep-alive), and multiple contexts may be mounted at once
  // when the editor grid is not remounted on context switch. The contextId in
  // the outer key namespaces contexts whose pane ids overlap. Only the host
  // matching the active context + active pane + active document is surfaced via
  // getActiveHost(). The inner Map is keyed by documentId and holds at most one
  // entry per document (the latest generation wins).
  const hostsByPaneDocument = new Map<string, Map<string, HostEntry>>();
  const cursorListeners = new Set<(status: EditorCursorStatus) => void>();
  let disposed = false;

  function getDocumentMap(key: string): Map<string, HostEntry> | undefined {
    return hostsByPaneDocument.get(key);
  }

  function ensureDocumentMap(key: string): Map<string, HostEntry> {
    let map = hostsByPaneDocument.get(key);
    if (!map) {
      map = new Map();
      hostsByPaneDocument.set(key, map);
    }
    return map;
  }

  function getActiveHost(): EditorHost | null {
    if (disposed) {
      return null;
    }
    const contextId = deps.getActiveContextId();
    const paneId = deps.getActivePaneId();
    const documentId = deps.getActiveDocumentId();
    if (!documentId) {
      return null;
    }
    const entry = getDocumentMap(paneKey(contextId, paneId))?.get(documentId);
    return entry ? entry.host : null;
  }

  function registerHost(host: EditorHost): EditorHostRegistration {
    const { identity } = host;
    if (disposed) {
      return { identity, unregister: () => {} };
    }

    // Hosts without a document id (defensive: editor surfaces always carry one
    // today) cannot be indexed by document, so skip registration entirely.
    if (!identity.documentId) {
      return { identity, unregister: () => {} };
    }

    const key = paneKey(identity.contextId, identity.paneId);
    const docMap = ensureDocumentMap(key);
    const existing = docMap.get(identity.documentId);
    if (existing && existing.identity.generation > identity.generation) {
      // Late registration from an older generation of the same document — reject.
      return { identity, unregister: () => {} };
    }

    docMap.set(identity.documentId, { identity, host });

    let unregistered = false;
    const unregister = (): void => {
      if (unregistered) {
        return;
      }
      unregistered = true;
      if (!identity.documentId) {
        return;
      }
      const current = getDocumentMap(key);
      if (!current) {
        return;
      }
      const entry = current.get(identity.documentId);
      // Stale unregister must not clear a newer host for the same document.
      if (entry && identitiesEqual(entry.identity, identity)) {
        current.delete(identity.documentId);
        if (current.size === 0) {
          hostsByPaneDocument.delete(key);
        }
      }
    };

    return { identity, unregister };
  }

  function getActiveRunner(): EditorCommandRunner | null {
    const host = getActiveHost();
    return host ? editorHostToCommandRunner(host) : null;
  }

  function publishCursorStatus(
    identity: EditorHostIdentity,
    line: number,
    column: number,
    selectionCount: number,
  ): void {
    if (disposed) {
      return;
    }
    const active = getActiveHost();
    if (!active || !identitiesEqual(active.identity, identity)) {
      return;
    }
    const status: EditorCursorStatus = { identity, line, column, selectionCount };
    for (const listener of cursorListeners) {
      listener(status);
    }
  }

  function subscribeCursorStatus(
    listener: (status: EditorCursorStatus) => void,
  ): () => void {
    cursorListeners.add(listener);
    return () => {
      cursorListeners.delete(listener);
    };
  }

  function focusActive(): void {
    getActiveHost()?.focus();
  }

  function dispose(): void {
    disposed = true;
    hostsByPaneDocument.clear();
    cursorListeners.clear();
  }

  return {
    registerHost,
    getActiveHost,
    getActiveRunner,
    publishCursorStatus,
    subscribeCursorStatus,
    focusActive,
    dispose,
  };
}
