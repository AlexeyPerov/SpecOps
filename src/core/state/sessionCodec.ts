import type { AppState, Document } from './types'
import { selectActiveProject } from './selectors'

/** Mirrors main-process persisted preferences JSON v1. */
export interface PreferencesPersistedV1 {
  readonly version: 2
  readonly themeMode: AppState['themeMode']
  readonly fileListSort: AppState['fileListSort']
  readonly fileListGrouping: AppState['fileListGrouping']
  readonly expandedFolderGroups: readonly string[]
  readonly workspaceFolderPath: string | null
  readonly autosaveEnabled: boolean
  readonly editorSoftWrap: boolean
  readonly editorLineNumbers: boolean
  readonly recentsPaneWidthPx: number
}

export interface SessionDocumentPersistedV1 {
  readonly id: string
  readonly title: string
  readonly path: string | null
  readonly lastModified: string | null
  readonly lastOpened: string
  readonly content: string
}

export interface SessionProjectPersistedV1 {
  readonly projectId: string
  readonly workspaceFolderPath: string | null
  readonly fileListSort: AppState['fileListSort']
  readonly fileListGrouping: AppState['fileListGrouping']
  readonly expandedFolderGroups: readonly string[]
  readonly recentDocumentIds: readonly string[]
  readonly documents: readonly SessionDocumentPersistedV1[]
  readonly currentDocumentId: string | null
}

export interface SessionPersistedV1 {
  readonly version: 2
  readonly activeProjectId: string
  readonly projects: readonly SessionProjectPersistedV1[]
}

export const DEFAULT_PREFERENCES_V1: PreferencesPersistedV1 = {
  version: 2,
  themeMode: 'system',
  fileListSort: 'lastOpened',
  fileListGrouping: 'none',
  expandedFolderGroups: [],
  workspaceFolderPath: null,
  autosaveEnabled: false,
  editorSoftWrap: true,
  editorLineNumbers: true,
  recentsPaneWidthPx: 260
}

/** Merge persisted prefs onto baseline AppState (session/doc fields unchanged). */
export function mergePreferencesIntoState(base: AppState, prefs: PreferencesPersistedV1): AppState {
  const projectsById = new Map(base.projectsById)
  const active = projectsById.get(base.activeProjectId)
  if (active) {
    projectsById.set(base.activeProjectId, {
      ...active,
      fileListSort: prefs.fileListSort,
      fileListGrouping: prefs.fileListGrouping,
      expandedFolderGroups: [...prefs.expandedFolderGroups],
      workspaceFolderPath: prefs.workspaceFolderPath
    })
  }
  return {
    ...base,
    projectsById,
    themeMode: prefs.themeMode,
    fileListSort: prefs.fileListSort,
    fileListGrouping: prefs.fileListGrouping,
    expandedFolderGroups: [...prefs.expandedFolderGroups],
    workspaceFolderPath: prefs.workspaceFolderPath,
    autosaveEnabled: prefs.autosaveEnabled,
    editorSoftWrap: prefs.editorSoftWrap,
    editorLineNumbers: prefs.editorLineNumbers,
    recentsPaneWidthPx: prefs.recentsPaneWidthPx
  }
}

/** Build AppState document map + selection from session blob after disk merge. */
export function mergeSessionIntoState(
  base: AppState,
  session: SessionPersistedV1
): AppState {
  const projectsById = new Map(base.projectsById)
  for (const project of session.projects) {
    const documentsById = new Map<string, Document>()
    const seen = new Set<string>()
    for (const d of project.documents) {
      if (seen.has(d.id)) continue
      seen.add(d.id)
      const doc: Document = {
        id: d.id,
        title: d.title,
        path: d.path,
        lastModified: d.lastModified,
        lastOpened: d.lastOpened,
        content: d.content
      }
      documentsById.set(d.id, doc)
    }

    const recentDocumentIds = project.recentDocumentIds.filter((id) => documentsById.has(id))
    const currentDocumentId =
      project.currentDocumentId !== null && documentsById.has(project.currentDocumentId)
        ? project.currentDocumentId
        : recentDocumentIds[0] ?? null
    const editorContent =
      currentDocumentId !== null ? documentsById.get(currentDocumentId)?.content ?? '' : ''

    projectsById.set(project.projectId, {
      documentsById,
      recentDocumentIds,
      currentDocumentId,
      editorContent,
      workspaceFolderPath: project.workspaceFolderPath,
      fileListSort: project.fileListSort,
      fileListGrouping: project.fileListGrouping,
      expandedFolderGroups: [...project.expandedFolderGroups]
    })
  }

  const activeProjectId = projectsById.has(session.activeProjectId)
    ? session.activeProjectId
    : base.activeProjectId
  const activeProject = projectsById.get(activeProjectId) ?? selectActiveProject(base)

  return {
    ...base,
    projectsById,
    activeProjectId,
    documentsById: activeProject.documentsById,
    recentDocumentIds: activeProject.recentDocumentIds,
    currentDocumentId: activeProject.currentDocumentId,
    editorContent: activeProject.editorContent,
    workspaceFolderPath: activeProject.workspaceFolderPath,
    fileListSort: activeProject.fileListSort,
    fileListGrouping: activeProject.fileListGrouping,
    expandedFolderGroups: activeProject.expandedFolderGroups
  }
}

/** Snapshot baseline documents + ordering for session.json (Document.content = saved baseline). */
export function serializeSessionFromState(state: AppState): SessionPersistedV1 {
  const projects: SessionProjectPersistedV1[] = []
  for (const [projectId, project] of state.projectsById.entries()) {
    const documents: SessionDocumentPersistedV1[] = []
    const seen = new Set<string>()
    for (const id of project.recentDocumentIds) {
      const doc = project.documentsById.get(id)
      if (!doc || seen.has(id)) continue
      seen.add(id)
      documents.push({
        id: doc.id,
        title: doc.title,
        path: doc.path,
        lastModified: doc.lastModified,
        lastOpened: doc.lastOpened,
        content: doc.content
      })
    }
    projects.push({
      projectId,
      workspaceFolderPath: project.workspaceFolderPath,
      fileListSort: project.fileListSort,
      fileListGrouping: project.fileListGrouping,
      expandedFolderGroups: [...project.expandedFolderGroups],
      recentDocumentIds: [...project.recentDocumentIds],
      documents,
      currentDocumentId: project.currentDocumentId
    })
  }
  return {
    version: 2,
    activeProjectId: state.activeProjectId,
    projects
  }
}

/** Preferences snapshot derived from AppState. */
export function serializePreferencesFromState(state: AppState): PreferencesPersistedV1 {
  const project = selectActiveProject(state)
  return {
    version: 2,
    themeMode: state.themeMode,
    fileListSort: project.fileListSort,
    fileListGrouping: project.fileListGrouping,
    expandedFolderGroups: [...project.expandedFolderGroups],
    workspaceFolderPath: project.workspaceFolderPath,
    autosaveEnabled: state.autosaveEnabled,
    editorSoftWrap: state.editorSoftWrap,
    editorLineNumbers: state.editorLineNumbers,
    recentsPaneWidthPx: state.recentsPaneWidthPx
  }
}

export function isRecoverableDraft(
  baselineEditorContent: string,
  draftContent: string | null | undefined
): boolean {
  if (draftContent === null || draftContent === undefined) return false
  return draftContent !== baselineEditorContent
}

/** Re-read filesystem-backed docs so session restore tracks disk truth (FR-46). */
export async function refreshSessionDocumentsFromDisk(
  documents: readonly SessionDocumentPersistedV1[],
  readTextFile: (
    absolutePath: string
  ) => Promise<
    | { readonly ok: true; readonly content: string; readonly mtimeIso: string | null }
    | { readonly ok: false; readonly reason: string }
  >
): Promise<SessionDocumentPersistedV1[]> {
  const out: SessionDocumentPersistedV1[] = []
  for (const d of documents) {
    if (!d.path?.trim()) {
      out.push(d)
      continue
    }
    const r = await readTextFile(d.path)
    if (r.ok) {
      out.push({ ...d, content: r.content, lastModified: r.mtimeIso })
    }
  }
  return out
}
