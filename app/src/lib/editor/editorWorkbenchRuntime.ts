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
import { editorHostToCommandRunner } from "./editorHostFactory";

export type EditorCursorStatus = {
  identity: EditorHostIdentity;
  line: number;
  column: number;
  /** Number of active selection ranges (1 for single cursor; >1 for multi-cursor). */
  selectionCount: number;
};

export type EditorWorkbenchRuntimeDeps = {
  getActivePaneId: () => string;
  getActiveDocumentId: () => string | null;
};

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
  // Hosts are keyed by (paneId, documentId). A pane may hold several live hosts
  // at once when the editor surface keeps multiple document tabs mounted (tab
  // keep-alive); only the host matching the active pane + active document is
  // surfaced via getActiveHost(). The inner Map is keyed by documentId and
  // holds at most one entry per document (the latest generation wins).
  const hostsByPaneDocument = new Map<string, Map<string, HostEntry>>();
  const cursorListeners = new Set<(status: EditorCursorStatus) => void>();
  let disposed = false;

  function getDocumentMap(paneId: string): Map<string, HostEntry> | undefined {
    return hostsByPaneDocument.get(paneId);
  }

  function ensureDocumentMap(paneId: string): Map<string, HostEntry> {
    let map = hostsByPaneDocument.get(paneId);
    if (!map) {
      map = new Map();
      hostsByPaneDocument.set(paneId, map);
    }
    return map;
  }

  function getActiveHost(): EditorHost | null {
    if (disposed) {
      return null;
    }
    const paneId = deps.getActivePaneId();
    const documentId = deps.getActiveDocumentId();
    if (!documentId) {
      return null;
    }
    const entry = getDocumentMap(paneId)?.get(documentId);
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

    const docMap = ensureDocumentMap(identity.paneId);
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
      const current = getDocumentMap(identity.paneId);
      if (!current) {
        return;
      }
      const entry = current.get(identity.documentId);
      // Stale unregister must not clear a newer host for the same document.
      if (entry && identitiesEqual(entry.identity, identity)) {
        current.delete(identity.documentId);
        if (current.size === 0) {
          hostsByPaneDocument.delete(identity.paneId);
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
