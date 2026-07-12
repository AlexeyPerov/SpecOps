/**
 * Document-scoped editor session cache.
 *
 * Policy: sessions are keyed by `{ paneId, documentId }` — the same document
 * shown in multiple panes keeps independent view sessions (selection, undo
 * history, and fold/completion/bookmark fields). Fold state is ephemeral: it
 * lives in cached EditorState while a pane/document remains mounted and is
 * never written to app session storage.
 *
 * Only inactive sessions live here; the live EditorView holds the active one.
 * Scroll position stays in `DocumentState.scrollTop` and is not cached.
 */
import type { EditorState } from "@codemirror/state";

export type EditorSessionKey = {
  paneId: string;
  documentId: string;
};

export type EditorDocumentSessionCacheOptions = {
  /** Maximum inactive EditorState snapshots retained. Default: 32. */
  maxEntries?: number;
};

export type EditorDocumentSessionCache = {
  save: (key: EditorSessionKey, state: EditorState) => void;
  /** Remove and return a cached state, or undefined on miss. */
  take: (key: EditorSessionKey) => EditorState | undefined;
  peek: (key: EditorSessionKey) => EditorState | undefined;
  has: (key: EditorSessionKey) => boolean;
  invalidateDocument: (documentId: string) => void;
  /** Drop sessions for a pane (e.g. EditorView teardown — cached states bind to that view's compartments). */
  invalidatePane: (paneId: string) => void;
  /** Drop sessions whose documentId is not in the retained set. */
  retainDocuments: (documentIds: ReadonlySet<string>) => void;
  clear: () => void;
  size: () => number;
  maxEntries: () => number;
};

type CacheEntry = {
  key: EditorSessionKey;
  state: EditorState;
  lastAccess: number;
};

export const DEFAULT_EDITOR_SESSION_CACHE_MAX = 32;

export function sessionKeyId(key: EditorSessionKey): string {
  return `${key.paneId}\0${key.documentId}`;
}

export function createEditorDocumentSessionCache(
  options: EditorDocumentSessionCacheOptions = {},
): EditorDocumentSessionCache {
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_EDITOR_SESSION_CACHE_MAX);
  const entries = new Map<string, CacheEntry>();
  let accessClock = 0;
  let disposed = false;

  function touch(entry: CacheEntry): void {
    accessClock += 1;
    entry.lastAccess = accessClock;
  }

  function evictOverflow(): void {
    while (entries.size > maxEntries) {
      let oldestId: string | null = null;
      let oldestAccess = Infinity;
      for (const [id, entry] of entries) {
        if (entry.lastAccess < oldestAccess) {
          oldestAccess = entry.lastAccess;
          oldestId = id;
        }
      }
      if (oldestId === null) {
        break;
      }
      entries.delete(oldestId);
    }
  }

  function save(key: EditorSessionKey, state: EditorState): void {
    if (disposed || !key.documentId) {
      return;
    }
    const id = sessionKeyId(key);
    const entry: CacheEntry = { key, state, lastAccess: 0 };
    touch(entry);
    entries.set(id, entry);
    evictOverflow();
  }

  function take(key: EditorSessionKey): EditorState | undefined {
    if (disposed) {
      return undefined;
    }
    const id = sessionKeyId(key);
    const entry = entries.get(id);
    if (!entry) {
      return undefined;
    }
    entries.delete(id);
    return entry.state;
  }

  function peek(key: EditorSessionKey): EditorState | undefined {
    if (disposed) {
      return undefined;
    }
    const entry = entries.get(sessionKeyId(key));
    if (!entry) {
      return undefined;
    }
    touch(entry);
    return entry.state;
  }

  function has(key: EditorSessionKey): boolean {
    return !disposed && entries.has(sessionKeyId(key));
  }

  function invalidateDocument(documentId: string): void {
    if (disposed || !documentId) {
      return;
    }
    for (const [id, entry] of entries) {
      if (entry.key.documentId === documentId) {
        entries.delete(id);
      }
    }
  }

  function invalidatePane(paneId: string): void {
    if (disposed || !paneId) {
      return;
    }
    for (const [id, entry] of entries) {
      if (entry.key.paneId === paneId) {
        entries.delete(id);
      }
    }
  }

  function retainDocuments(documentIds: ReadonlySet<string>): void {
    if (disposed) {
      return;
    }
    for (const [id, entry] of entries) {
      if (!documentIds.has(entry.key.documentId)) {
        entries.delete(id);
      }
    }
  }

  function clear(): void {
    disposed = true;
    entries.clear();
  }

  return {
    save,
    take,
    peek,
    has,
    invalidateDocument,
    invalidatePane,
    retainDocuments,
    clear,
    size: () => entries.size,
    maxEntries: () => maxEntries,
  };
}
