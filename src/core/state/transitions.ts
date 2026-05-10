import { folderKeyForDocumentPath, groupsForPresentation } from './fileListPresentation'
import type { AppAction, AppState, Document } from './types'

export function createInitialAppState(): AppState {
  return {
    documentsById: new Map(),
    recentDocumentIds: [],
    currentDocumentId: null,
    editorContent: '',
    themeMode: 'system',
    fileListSort: 'lastOpened',
    fileListGrouping: 'none',
    expandedFolderGroups: [],
    workspaceFolderPath: null
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

    case 'SET_THEME_MODE':
      return { ...state, themeMode: action.mode }

    case 'SET_FILE_LIST_SORT':
      return { ...state, fileListSort: action.sort }

    case 'SET_FILE_LIST_GROUPING': {
      if (action.grouping === 'none') {
        return { ...state, fileListGrouping: 'none', expandedFolderGroups: [] }
      }
      const next: AppState = { ...state, fileListGrouping: 'folder' }
      const keys = groupsForPresentation(next).map((g) => g.key)
      return { ...next, expandedFolderGroups: [...keys] }
    }

    case 'TOGGLE_FOLDER_EXPANDED': {
      const fk = action.folderKey
      const nextExpanded = state.expandedFolderGroups.includes(fk)
        ? state.expandedFolderGroups.filter((k) => k !== fk)
        : [...state.expandedFolderGroups, fk]
      return { ...state, expandedFolderGroups: nextExpanded }
    }

    case 'REMOVE_FROM_RECENTS': {
      const filtered = state.recentDocumentIds.filter((id) => id !== action.documentId)
      let currentDocumentId = state.currentDocumentId
      let editorContent = state.editorContent
      if (state.currentDocumentId === action.documentId) {
        currentDocumentId = filtered[0] ?? null
        editorContent = currentDocumentId
          ? state.documentsById.get(currentDocumentId)?.content ?? ''
          : ''
      }
      return {
        ...state,
        recentDocumentIds: filtered,
        currentDocumentId,
        editorContent
      }
    }

    case 'SYNC_DOCUMENT_FROM_DISK': {
      const doc = state.documentsById.get(action.documentId)
      if (!doc) return state
      const documentsById = new Map(state.documentsById)
      documentsById.set(action.documentId, {
        ...doc,
        content: action.content,
        lastModified: action.lastModified
      })
      const editorContent =
        state.currentDocumentId === action.documentId ? action.content : state.editorContent
      return { ...state, documentsById, editorContent }
    }

    case 'SET_WORKSPACE_FOLDER':
      return { ...state, workspaceFolderPath: action.path }

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

      let expandedFolderGroups = state.expandedFolderGroups
      if (state.fileListGrouping === 'folder') {
        const fk = folderKeyForDocumentPath(doc.path)
        if (!expandedFolderGroups.includes(fk)) {
          expandedFolderGroups = [...expandedFolderGroups, fk]
        }
      }

      return {
        ...state,
        documentsById,
        recentDocumentIds,
        currentDocumentId: doc.id,
        editorContent: doc.content,
        expandedFolderGroups
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
