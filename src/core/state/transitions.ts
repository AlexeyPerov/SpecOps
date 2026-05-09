import type { AppAction, AppState, Document } from './types'

export function createInitialAppState(): AppState {
  return {
    documentsById: new Map(),
    recentDocumentIds: [],
    currentDocumentId: null,
    editorContent: ''
  }
}

function dedupeRecents(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Pure state reducer — inject `nowIso` for deterministic tests (NR-01 / DATA-01 / DATA-08). */
export function reduceAppState(state: AppState, action: AppAction, nowIso: string): AppState {
  switch (action.type) {
    case 'EDITOR_CHANGE':
      return { ...state, editorContent: action.content }

    case 'OPEN_EXPLICIT': {
      const doc: Document = {
        ...action.document,
        lastOpened: nowIso
      }
      const documentsById = new Map(state.documentsById)
      documentsById.set(doc.id, doc)
      const recentDocumentIds = dedupeRecents([
        doc.id,
        ...state.recentDocumentIds.filter((id) => id !== doc.id)
      ])
      return {
        ...state,
        documentsById,
        recentDocumentIds,
        currentDocumentId: doc.id,
        editorContent: doc.content
      }
    }

    case 'ACTIVATE_FROM_RECENT_LIST': {
      const doc = state.documentsById.get(action.documentId)
      if (!doc) return state
      return {
        ...state,
        currentDocumentId: doc.id,
        editorContent: doc.content
      }
    }
  }
}
