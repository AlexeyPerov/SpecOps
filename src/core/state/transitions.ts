import { createEmptyChatState } from '../chat/chatState'
import { folderKeyForDocumentPath, groupsForPresentation } from './fileListPresentation'
import type { AppAction, AppState, Document, ProjectState, ScrollSnapshot } from './types'
import type { PanelMode } from './types'
import { sanitizeMarkdownScanRelativeFolders } from '../util/markdownScanFolders'
import { pathBasename, stableDocIdForPath } from '../util/paths'

export const DEFAULT_PROJECT_ID = 'default'
const MIN_FONT_SIZE_PX = 10
const MAX_FONT_SIZE_PX = 24

function clampFontSizePx(sizePx: number, fallback: number): number {
  const rounded = Number.isFinite(sizePx) ? Math.round(sizePx) : fallback
  return Math.min(MAX_FONT_SIZE_PX, Math.max(MIN_FONT_SIZE_PX, rounded))
}

function createInitialProjectState(): ProjectState {
  return {
    chat: createEmptyChatState(),
    documentsById: new Map(),
    recentDocumentIds: [],
    currentDocumentId: null,
    editorContent: '',
    workspaceFolderPath: null,
    accentColor: '#6f7684',
    fileListSort: 'lastOpened',
    fileListGrouping: 'folder',
    expandedFolderGroups: [],
    panelMode: 'recents',
    scrollSnapshots: new Map()
  }
}

function withActiveProject(state: AppState, project: ProjectState): AppState {
  return {
    ...state,
    documentsById: project.documentsById,
    recentDocumentIds: project.recentDocumentIds,
    currentDocumentId: project.currentDocumentId,
    editorContent: project.editorContent,
    workspaceFolderPath: project.workspaceFolderPath,
    fileListSort: project.fileListSort,
    fileListGrouping: project.fileListGrouping,
    expandedFolderGroups: project.expandedFolderGroups,
    panelMode: project.panelMode,
    scrollSnapshots: project.scrollSnapshots
  }
}

function activeProject(state: AppState): ProjectState {
  return state.projectsById.get(state.activeProjectId) ?? createInitialProjectState()
}

function patchActiveProject(state: AppState, patch: Partial<ProjectState>): AppState {
  const current = activeProject(state)
  const next: ProjectState = { ...current, ...patch }
  const projectsById = new Map(state.projectsById)
  projectsById.set(state.activeProjectId, next)
  return withActiveProject({ ...state, projectsById }, next)
}

export function createInitialAppState(): AppState {
  const initialProject = createInitialProjectState()
  const projectsById = new Map<string, ProjectState>([[DEFAULT_PROJECT_ID, initialProject]])
  return {
    projectsById,
    activeProjectId: DEFAULT_PROJECT_ID,
    themeMode: 'system',
    autosaveEnabled: false,
    editorSoftWrap: true,
    editorLineNumbers: true,
    editorFontSizePx: 13,
    previewFontSizePx: 16,
    recentsPaneWidthPx: 260,
    markdownScanRelativeFolders: sanitizeMarkdownScanRelativeFolders(['specs']),
    excludeGitDirectory: true,
    excludeNodeModules: true,
    panelMode: 'recents' as PanelMode,
    scrollSnapshots: initialProject.scrollSnapshots,
    documentsById: initialProject.documentsById,
    recentDocumentIds: initialProject.recentDocumentIds,
    currentDocumentId: initialProject.currentDocumentId,
    editorContent: initialProject.editorContent,
    workspaceFolderPath: initialProject.workspaceFolderPath,
    fileListSort: initialProject.fileListSort,
    fileListGrouping: initialProject.fileListGrouping,
    expandedFolderGroups: initialProject.expandedFolderGroups
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

function patchProjectById(state: AppState, projectId: string, patch: Partial<ProjectState>): AppState {
  const current = state.projectsById.get(projectId)
  if (!current) return state
  const next: ProjectState = { ...current, ...patch }
  const projectsById = new Map(state.projectsById)
  projectsById.set(projectId, next)
  if (projectId === state.activeProjectId) {
    return withActiveProject({ ...state, projectsById }, next)
  }
  return { ...state, projectsById }
}

/** Pure state reducer — inject `nowIso` for deterministic tests (NR-01 / DATA-01 / DATA-08). */
export function reduceAppState(state: AppState, action: AppAction, nowIso: string): AppState {
  if (action.type === 'CREATE_PROJECT') {
    if (state.projectsById.has(action.projectId)) return state
    const project: ProjectState = {
      ...createInitialProjectState(),
      workspaceFolderPath: action.workspaceFolderPath ?? null,
      accentColor: action.accentColor ?? '#6f7684'
    }
    const projectsById = new Map(state.projectsById)
    projectsById.set(action.projectId, project)
    return { ...state, projectsById }
  }

  if (action.type === 'SET_ACTIVE_PROJECT') {
    const project = state.projectsById.get(action.projectId)
    if (!project) return state
    return withActiveProject({ ...state, activeProjectId: action.projectId }, project)
  }

  if (action.type === 'REMOVE_PROJECT') {
    if (!state.projectsById.has(action.projectId)) return state
    if (state.projectsById.size <= 1) return state
    const projectsById = new Map(state.projectsById)
    projectsById.delete(action.projectId)
    if (action.projectId !== state.activeProjectId) {
      return { ...state, projectsById }
    }
    const [nextId, nextProject] = projectsById.entries().next().value as [string, ProjectState]
    return withActiveProject({ ...state, projectsById, activeProjectId: nextId }, nextProject)
  }

  if (action.type === 'CLEAR_NON_DEFAULT_PROJECTS') {
    const defaultProject = state.projectsById.get(DEFAULT_PROJECT_ID) ?? createInitialProjectState()
    const projectsById = new Map<string, ProjectState>([[DEFAULT_PROJECT_ID, defaultProject]])
    return withActiveProject({ ...state, projectsById, activeProjectId: DEFAULT_PROJECT_ID }, defaultProject)
  }

  if (action.type === 'UPSERT_PROJECT_DOCUMENTS') {
    const project = state.projectsById.get(action.projectId)
    if (!project) return state
    const documentsById = new Map(project.documentsById)
    for (const input of action.documents) {
      const doc: Document = {
        ...input,
        lastOpened: nowIso,
        saveIntentDirectory: input.saveIntentDirectory ?? null
      }
      documentsById.set(doc.id, doc)
    }
    const mergedRecents = dedupeRecents([
      ...action.documents.map((d) => d.id),
      ...project.recentDocumentIds
    ])
    let expandedFolderGroups = project.expandedFolderGroups
    if (project.fileListGrouping === 'folder') {
      const known = new Set(expandedFolderGroups)
      for (const d of action.documents) {
        const fk = folderKeyForDocumentPath(d.path)
        if (known.has(fk)) continue
        known.add(fk)
        expandedFolderGroups = [...expandedFolderGroups, fk]
      }
    }
    return patchProjectById(state, action.projectId, {
      documentsById,
      recentDocumentIds: mergedRecents,
      expandedFolderGroups
    })
  }

  switch (action.type) {
    case 'EDITOR_CHANGE':
      return patchActiveProject(state, { editorContent: action.content })

    case 'SET_THEME_MODE':
      return { ...state, themeMode: action.mode }

    case 'SET_FILE_LIST_SORT':
      return patchActiveProject(state, { fileListSort: action.sort })

    case 'SET_FILE_LIST_GROUPING': {
      if (action.grouping === 'none') {
        return patchActiveProject(state, { fileListGrouping: 'none', expandedFolderGroups: [] })
      }
      const next = patchActiveProject(state, { fileListGrouping: 'folder' })
      const keys = groupsForPresentation(next).map((g) => g.key)
      return patchActiveProject(next, { expandedFolderGroups: [...keys] })
    }

    case 'TOGGLE_FOLDER_EXPANDED': {
      const fk = action.folderKey
      const nextExpanded = state.expandedFolderGroups.includes(fk)
        ? state.expandedFolderGroups.filter((k) => k !== fk)
        : [...state.expandedFolderGroups, fk]
      return patchActiveProject(state, { expandedFolderGroups: nextExpanded })
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
      return patchActiveProject(state, { recentDocumentIds: filtered, currentDocumentId, editorContent })
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
      return patchActiveProject(state, { documentsById, editorContent })
    }

    case 'SET_WORKSPACE_FOLDER':
      return patchActiveProject(state, { workspaceFolderPath: action.path })

    case 'SET_AUTOSAVE_ENABLED':
      return { ...state, autosaveEnabled: action.enabled }

    case 'SET_EDITOR_SOFT_WRAP':
      return { ...state, editorSoftWrap: action.enabled }

    case 'SET_EDITOR_LINE_NUMBERS':
      return { ...state, editorLineNumbers: action.enabled }

    case 'SET_EDITOR_FONT_SIZE_PX':
      return {
        ...state,
        editorFontSizePx: clampFontSizePx(action.sizePx, state.editorFontSizePx)
      }

    case 'SET_PREVIEW_FONT_SIZE_PX':
      return {
        ...state,
        previewFontSizePx: clampFontSizePx(action.sizePx, state.previewFontSizePx)
      }

    case 'SET_RECENTS_PANE_WIDTH': {
      const w = Number.isFinite(action.widthPx) ? Math.round(action.widthPx) : state.recentsPaneWidthPx
      const clamped = Math.min(560, Math.max(180, w))
      return { ...state, recentsPaneWidthPx: clamped }
    }

    case 'SET_PANEL_MODE':
      return patchActiveProject(state, { panelMode: action.mode })

    case 'UPDATE_UNTITLED_TITLE': {
      const doc = state.documentsById.get(action.documentId)
      if (!doc || doc.path) return state
      const documentsById = new Map(state.documentsById)
      documentsById.set(action.documentId, { ...doc, title: action.title })
      return patchActiveProject(state, { documentsById })
    }

    case 'SET_SCROLL_SNAPSHOT': {
      const scrollSnapshots = new Map(state.scrollSnapshots)
      scrollSnapshots.set(action.documentId, action.snapshot)
      return patchActiveProject(state, { scrollSnapshots })
    }

    case 'SET_EXCLUDE_GIT_DIRECTORY':
      return { ...state, excludeGitDirectory: action.enabled }

    case 'SET_EXCLUDE_NODE_MODULES':
      return { ...state, excludeNodeModules: action.enabled }

    case 'SET_MARKDOWN_SCAN_RELATIVE_FOLDERS':
      return {
        ...state,
        markdownScanRelativeFolders: sanitizeMarkdownScanRelativeFolders(action.folders)
      }

    case 'REPARENT_DOCUMENT': {
      const doc = state.documentsById.get(action.oldDocumentId)
      if (!doc) return state
      const newId = stableDocIdForPath(action.newAbsolutePath)
      const documentsById = new Map(state.documentsById)
      documentsById.delete(action.oldDocumentId)
      const base = pathBasename(action.newAbsolutePath)
      const title = base.replace(/\.md$/i, '') || base
      documentsById.set(newId, {
        ...doc,
        id: newId,
        title,
        path: action.newAbsolutePath,
        content: action.content,
        lastModified: action.lastModified,
        saveIntentDirectory: null
      })
      const recentDocumentIds = dedupeRecents(
        state.recentDocumentIds.map((id) => (id === action.oldDocumentId ? newId : id))
      )
      let currentDocumentId = state.currentDocumentId
      let editorContent = state.editorContent
      if (state.currentDocumentId === action.oldDocumentId) {
        currentDocumentId = newId
        editorContent = action.content
      }
      let expandedFolderGroups = state.expandedFolderGroups
      if (state.fileListGrouping === 'folder') {
        const oldFk = folderKeyForDocumentPath(doc.path)
        const newFk = folderKeyForDocumentPath(action.newAbsolutePath)
        expandedFolderGroups = expandedFolderGroups.map((k) => (k === oldFk ? newFk : k))
      }
      return patchActiveProject(state, {
        documentsById,
        recentDocumentIds,
        currentDocumentId,
        editorContent,
        expandedFolderGroups
      })
    }

    case 'DROP_DOCUMENT': {
      if (!state.documentsById.has(action.documentId)) return state
      const documentsById = new Map(state.documentsById)
      documentsById.delete(action.documentId)
      const filtered = state.recentDocumentIds.filter((id) => id !== action.documentId)
      let currentDocumentId = state.currentDocumentId
      let editorContent = state.editorContent
      if (state.currentDocumentId === action.documentId) {
        currentDocumentId = filtered[0] ?? null
        editorContent = currentDocumentId
          ? documentsById.get(currentDocumentId)?.content ?? ''
          : ''
      }
      return patchActiveProject(state, {
        documentsById,
        recentDocumentIds: filtered,
        currentDocumentId,
        editorContent
      })
    }

    case 'OPEN_EXPLICIT': {
      const doc: Document = {
        ...action.document,
        lastOpened: nowIso,
        saveIntentDirectory: action.document.saveIntentDirectory ?? null
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

      return patchActiveProject(state, {
        documentsById,
        recentDocumentIds,
        currentDocumentId: doc.id,
        editorContent: doc.content,
        expandedFolderGroups
      })
    }

    case 'ACTIVATE_FROM_RECENT_LIST': {
      const doc = state.documentsById.get(action.documentId)
      if (!doc) return state
      return patchActiveProject(state, { currentDocumentId: doc.id, editorContent: doc.content })
    }
  }
}
