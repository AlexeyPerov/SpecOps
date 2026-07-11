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
  const hostsByPaneId = new Map<string, HostEntry>();
  const cursorListeners = new Set<(status: EditorCursorStatus) => void>();
  let disposed = false;

  function getActiveHost(): EditorHost | null {
    if (disposed) {
      return null;
    }
    const paneId = deps.getActivePaneId();
    const documentId = deps.getActiveDocumentId();
    const entry = hostsByPaneId.get(paneId);
    if (!entry) {
      return null;
    }
    if (entry.identity.documentId !== documentId) {
      return null;
    }
    return entry.host;
  }

  function registerHost(host: EditorHost): EditorHostRegistration {
    const { identity } = host;
    if (disposed) {
      return { identity, unregister: () => {} };
    }

    const existing = hostsByPaneId.get(identity.paneId);
    if (existing && existing.identity.generation > identity.generation) {
      // Late registration from an older document generation — reject.
      return { identity, unregister: () => {} };
    }

    hostsByPaneId.set(identity.paneId, { identity, host });

    let unregistered = false;
    const unregister = (): void => {
      if (unregistered) {
        return;
      }
      unregistered = true;
      const current = hostsByPaneId.get(identity.paneId);
      if (!current) {
        return;
      }
      // Stale unregister must not clear a newer active/registered host.
      if (identitiesEqual(current.identity, identity)) {
        hostsByPaneId.delete(identity.paneId);
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
  ): void {
    if (disposed) {
      return;
    }
    const active = getActiveHost();
    if (!active || !identitiesEqual(active.identity, identity)) {
      return;
    }
    const status: EditorCursorStatus = { identity, line, column };
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
    hostsByPaneId.clear();
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
