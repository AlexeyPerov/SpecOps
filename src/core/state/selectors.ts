import type { AppState, ProjectState } from './types'
import { createEmptyChatState } from '../chat/chatState'

export function selectActiveProject(state: AppState): ProjectState {
  return state.projectsById.get(state.activeProjectId) ?? {
    chat: createEmptyChatState(),
    documentsById: new Map(),
    recentDocumentIds: [],
    currentDocumentId: null,
    editorContent: '',
    workspaceFolderPath: null,
    accentColor: '#6f7684',
    fileListSort: 'lastOpened',
    fileListGrouping: 'folder',
    expandedFolderGroups: []
  }
}

export function selectCurrentDocumentPath(state: AppState): string | null {
  const project = selectActiveProject(state)
  if (!project.currentDocumentId) return null
  return project.documentsById.get(project.currentDocumentId)?.path ?? null
}
