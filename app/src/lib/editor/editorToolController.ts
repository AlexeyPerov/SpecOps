/**
 * Window-local editor chrome tools (find/replace, go-to, outline, heading-jump,
 * bookmark list). One tool at a time; closes on stale pane/document binding or
 * modal precedence.
 */

export type EditorToolId = "find" | "go-to" | "outline" | "heading-jump" | "bookmark-list";

export type EditorToolBinding = {
  paneId: string;
  documentId: string;
};

export type EditorFindState = {
  query: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
};

export type EditorToolSnapshot = {
  activeTool: EditorToolId | null;
  binding: EditorToolBinding | null;
  find: EditorFindState;
  goToLineValue: string;
};

export type EditorToolControllerDeps = {
  getActiveBinding: () => EditorToolBinding | null;
  focusEditor: () => void;
  /** True when a modal/dialog should own Escape/chords over editor tools. */
  isModalOpen: () => boolean;
};

export type EditorToolController = {
  getSnapshot: () => EditorToolSnapshot;
  subscribe: (listener: (snapshot: EditorToolSnapshot) => void) => () => void;
  open: (tool: EditorToolId) => void;
  close: (options?: { restoreFocus?: boolean }) => void;
  toggle: (tool: EditorToolId) => void;
  setFindQuery: (query: string) => void;
  setFindReplace: (replace: string) => void;
  setFindCaseSensitive: (value: boolean) => void;
  setFindWholeWord: (value: boolean) => void;
  setFindRegexp: (value: boolean) => void;
  setGoToLineValue: (value: string) => void;
  /**
   * Close the active tool when the pane/document binding no longer matches,
   * or when a modal is open (modal precedence).
   */
  syncToEnvironment: () => void;
  dispose: () => void;
};

function bindingsEqual(
  a: EditorToolBinding | null,
  b: EditorToolBinding | null,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.paneId === b.paneId && a.documentId === b.documentId;
}

function cloneSnapshot(snapshot: EditorToolSnapshot): EditorToolSnapshot {
  return {
    activeTool: snapshot.activeTool,
    binding: snapshot.binding
      ? { paneId: snapshot.binding.paneId, documentId: snapshot.binding.documentId }
      : null,
    find: { ...snapshot.find },
    goToLineValue: snapshot.goToLineValue,
  };
}

export function createEditorToolController(
  deps: EditorToolControllerDeps,
): EditorToolController {
  let snapshot: EditorToolSnapshot = {
    activeTool: null,
    binding: null,
    find: { query: "", replace: "", caseSensitive: false, wholeWord: false, regexp: false },
    goToLineValue: "",
  };
  const listeners = new Set<(next: EditorToolSnapshot) => void>();
  let disposed = false;

  function emit(): void {
    const next = cloneSnapshot(snapshot);
    for (const listener of listeners) {
      listener(next);
    }
  }

  function closeInternal(options?: { restoreFocus?: boolean }): void {
    if (snapshot.activeTool === null) {
      return;
    }
    snapshot = {
      ...snapshot,
      activeTool: null,
      binding: null,
    };
    emit();
    if (options?.restoreFocus !== false) {
      deps.focusEditor();
    }
  }

  function open(tool: EditorToolId): void {
    if (disposed) {
      return;
    }
    if (deps.isModalOpen()) {
      return;
    }
    const binding = deps.getActiveBinding();
    if (!binding) {
      return;
    }
    if (snapshot.activeTool === tool && bindingsEqual(snapshot.binding, binding)) {
      return;
    }
    snapshot = {
      ...snapshot,
      activeTool: tool,
      binding,
    };
    emit();
  }

  function toggle(tool: EditorToolId): void {
    if (disposed) {
      return;
    }
    const binding = deps.getActiveBinding();
    if (
      snapshot.activeTool === tool &&
      bindingsEqual(snapshot.binding, binding)
    ) {
      closeInternal({ restoreFocus: true });
      return;
    }
    open(tool);
  }

  function syncToEnvironment(): void {
    if (disposed || snapshot.activeTool === null) {
      return;
    }
    if (deps.isModalOpen()) {
      closeInternal({ restoreFocus: false });
      return;
    }
    const binding = deps.getActiveBinding();
    if (!bindingsEqual(snapshot.binding, binding)) {
      closeInternal({ restoreFocus: false });
    }
  }

  return {
    getSnapshot: () => cloneSnapshot(snapshot),
    subscribe(listener) {
      listeners.add(listener);
      listener(cloneSnapshot(snapshot));
      return () => {
        listeners.delete(listener);
      };
    },
    open,
    close(options) {
      if (disposed) {
        return;
      }
      closeInternal(options);
    },
    toggle,
    setFindQuery(query) {
      if (disposed || snapshot.find.query === query) {
        return;
      }
      snapshot = { ...snapshot, find: { ...snapshot.find, query } };
      emit();
    },
    setFindReplace(replace) {
      if (disposed || snapshot.find.replace === replace) {
        return;
      }
      snapshot = { ...snapshot, find: { ...snapshot.find, replace } };
      emit();
    },
    setFindCaseSensitive(caseSensitive) {
      if (disposed || snapshot.find.caseSensitive === caseSensitive) {
        return;
      }
      snapshot = { ...snapshot, find: { ...snapshot.find, caseSensitive } };
      emit();
    },
    setFindWholeWord(wholeWord) {
      if (disposed || snapshot.find.wholeWord === wholeWord) {
        return;
      }
      snapshot = { ...snapshot, find: { ...snapshot.find, wholeWord } };
      emit();
    },
    setFindRegexp(regexp) {
      if (disposed || snapshot.find.regexp === regexp) {
        return;
      }
      snapshot = { ...snapshot, find: { ...snapshot.find, regexp } };
      emit();
    },
    setGoToLineValue(goToLineValue) {
      if (disposed || snapshot.goToLineValue === goToLineValue) {
        return;
      }
      snapshot = { ...snapshot, goToLineValue };
      emit();
    },
    syncToEnvironment,
    dispose() {
      disposed = true;
      listeners.clear();
      snapshot = {
        activeTool: null,
        binding: null,
        find: { query: "", replace: "", caseSensitive: false, wholeWord: false, regexp: false },
        goToLineValue: "",
      };
    },
  };
}
