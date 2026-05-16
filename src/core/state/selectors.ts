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

export function isMarkdownFilePath(path: string): boolean {
  const lower = path.trim().toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown')
}

/**
 * Canonical markdown-capable check for the active document path.
 * Safe fallback: untitled / missing-path docs remain markdown-capable.
 */
export function isMarkdownCapableDocumentPath(path: string | null | undefined): boolean {
  if (typeof path !== 'string' || !path.trim()) return true
  return isMarkdownFilePath(path)
}
