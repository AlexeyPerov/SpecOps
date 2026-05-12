import type { AppState, ProjectState } from './types'

export function selectActiveProject(state: AppState): ProjectState {
  return state.projectsById.get(state.activeProjectId) ?? {
    documentsById: new Map(),
    recentDocumentIds: [],
    currentDocumentId: null,
    editorContent: '',
    workspaceFolderPath: null,
    fileListSort: 'lastOpened',
    fileListGrouping: 'none',
    expandedFolderGroups: []
  }
}

export function selectCurrentDocumentPath(state: AppState): string | null {
  const project = selectActiveProject(state)
  if (!project.currentDocumentId) return null
  return project.documentsById.get(project.currentDocumentId)?.path ?? null
}
