import type { DocumentState, TabState } from "../domain/contracts";
import { isFileTab } from "../domain/contracts";
import { isTabVisibleInStrip } from "./implicitDraftTab";

/** Build an id → document map for O(1) tab document lookups in a render cycle. */
export function buildDocumentByIdMap(
  documents: readonly DocumentState[],
): Map<string, DocumentState> {
  return new Map(documents.map((doc) => [doc.id, doc]));
}

const documentByIdCache = new WeakMap<
  readonly DocumentState[],
  Map<string, DocumentState>
>();

/**
 * Memoized {@link buildDocumentByIdMap} keyed by the documents array identity.
 * Multiple panes and nested TabBar instances share one Map per documents ref.
 */
export function getDocumentByIdMap(
  documents: readonly DocumentState[],
): Map<string, DocumentState> {
  const cached = documentByIdCache.get(documents);
  if (cached) {
    return cached;
  }
  const map = buildDocumentByIdMap(documents);
  documentByIdCache.set(documents, map);
  return map;
}

type VisibleTabsCacheEntry = {
  documentById: ReadonlyMap<string, DocumentState>;
  result: TabState[];
};

const visibleTabsCache = new WeakMap<readonly TabState[], VisibleTabsCacheEntry>();

/**
 * Memoized visible-tab filter for the tab strip. Reuses the filtered array when
 * openTabs and documentById identities are unchanged.
 */
export function filterVisibleTabs(
  openTabs: readonly TabState[],
  documentById: ReadonlyMap<string, DocumentState>,
): TabState[] {
  const cached = visibleTabsCache.get(openTabs);
  if (cached && cached.documentById === documentById) {
    return cached.result;
  }
  const result = openTabs.filter((tab) => {
    const tabDoc = isFileTab(tab) ? documentById.get(tab.documentId) : undefined;
    return isTabVisibleInStrip(tab, tabDoc);
  });
  visibleTabsCache.set(openTabs, { documentById, result });
  return result;
}

type SessionIndexEntry = { id: string; title: string };

const sessionTitleByIdCache = new WeakMap<
  readonly SessionIndexEntry[],
  Map<string, string>
>();

/** Memoized session id → title map keyed by the session index array identity. */
export function getSessionTitleById(
  sessionIndex: readonly SessionIndexEntry[],
): Map<string, string> {
  const cached = sessionTitleByIdCache.get(sessionIndex);
  if (cached) {
    return cached;
  }
  const map = new Map(sessionIndex.map((entry) => [entry.id, entry.title]));
  sessionTitleByIdCache.set(sessionIndex, map);
  return map;
}

/** Resolve a file tab's document via a precomputed map (session/view tabs → undefined). */
export function tabDocumentFromMap(
  tab: TabState,
  documentById: ReadonlyMap<string, DocumentState>,
): DocumentState | undefined {
  if (!isFileTab(tab)) {
    return undefined;
  }
  return documentById.get(tab.documentId);
}
