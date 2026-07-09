import type { DocumentState, TabState } from "../domain/contracts";
import { isFileTab } from "../domain/contracts";

/** Build an id → document map for O(1) tab document lookups in a render cycle. */
export function buildDocumentByIdMap(
  documents: readonly DocumentState[],
): Map<string, DocumentState> {
  return new Map(documents.map((doc) => [doc.id, doc]));
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
