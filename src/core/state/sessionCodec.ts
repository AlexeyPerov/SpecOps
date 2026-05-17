import type { AppState, Document, ScrollSnapshot } from './types'
import {
  chatStateFromPersisted,
  chatStateToPersisted,
  type ChatStatePersistedV1
} from '../chat/chatState'
import { selectActiveProject } from './selectors'
import { sanitizeMarkdownScanRelativeFolders } from '../util/markdownScanFolders'

const MIN_FONT_SIZE_PX = 10
const MAX_FONT_SIZE_PX = 24

function sanitizeFontSizePx(value: number, fallback: number): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(MAX_FONT_SIZE_PX, Math.max(MIN_FONT_SIZE_PX, rounded))
}

/**
 * Session/preferences codec for nested multi-project state (v2).
 * Per-project chat payloads are embedded in session projects for the stub; future
 * split blobs may live under `userData/specops/projects/<projectId>/chats/` (RR-04.5).
 */
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
  readonly editorFontSizePx: number
  readonly previewFontSizePx: number
  readonly recentsPaneWidthPx: number
  readonly markdownScanRelativeFolders: readonly string[]
  readonly excludeGitDirectory?: boolean
  readonly excludeNodeModules?: boolean
}

export interface SessionDocumentPersistedV1 {
  readonly id: string
  readonly title: string
  readonly path: string | null
  readonly lastModified: string | null
  readonly lastOpened: string
  readonly content: string
  readonly saveIntentDirectory?: string | null
}

export interface SessionProjectPersistedV1 {
  readonly projectId: string
  readonly workspaceFolderPath: string | null
  readonly accentColor?: string
  readonly fileListSort: AppState['fileListSort']
  readonly fileListGrouping: AppState['fileListGrouping']
  readonly expandedFolderGroups: readonly string[]
  readonly recentDocumentIds: readonly string[]
  readonly documents: readonly SessionDocumentPersistedV1[]
  readonly currentDocumentId: string | null
  readonly chat?: ChatStatePersistedV1
  readonly panelMode?: AppState['panelMode']
  readonly scrollSnapshots?: Readonly<Record<string, ScrollSnapshot>>
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
  fileListGrouping: 'folder',
  expandedFolderGroups: [],
  workspaceFolderPath: null,
  autosaveEnabled: false,
  editorSoftWrap: true,
  editorLineNumbers: true,
  editorFontSizePx: 13,
  previewFontSizePx: 16,
  recentsPaneWidthPx: 260,
  markdownScanRelativeFolders: ['specs'],
  excludeGitDirectory: true,
  excludeNodeModules: true
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
    editorFontSizePx: sanitizeFontSizePx(
      prefs.editorFontSizePx ?? DEFAULT_PREFERENCES_V1.editorFontSizePx,
      DEFAULT_PREFERENCES_V1.editorFontSizePx
    ),
    previewFontSizePx: sanitizeFontSizePx(
      prefs.previewFontSizePx ?? DEFAULT_PREFERENCES_V1.previewFontSizePx,
      DEFAULT_PREFERENCES_V1.previewFontSizePx
    ),
    recentsPaneWidthPx: prefs.recentsPaneWidthPx,
    markdownScanRelativeFolders: sanitizeMarkdownScanRelativeFolders(
      prefs.markdownScanRelativeFolders ?? DEFAULT_PREFERENCES_V1.markdownScanRelativeFolders
    ),
    excludeGitDirectory: prefs.excludeGitDirectory ?? true,
    excludeNodeModules: prefs.excludeNodeModules ?? true
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
        content: d.content,
        saveIntentDirectory: d.saveIntentDirectory ?? null
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
      chat: chatStateFromPersisted(project.chat),
      documentsById,
      recentDocumentIds,
      currentDocumentId,
      editorContent,
      workspaceFolderPath: project.workspaceFolderPath,
      accentColor:
        typeof project.accentColor === 'string' && project.accentColor.trim()
          ? project.accentColor
          : '#6f7684',
      fileListSort: project.fileListSort,
      fileListGrouping: project.fileListGrouping,
      expandedFolderGroups: [...project.expandedFolderGroups],
      panelMode: project.panelMode === 'explorer' ? 'explorer' : 'recents',
      scrollSnapshots: new Map(Object.entries(project.scrollSnapshots ?? {}))
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
    expandedFolderGroups: activeProject.expandedFolderGroups,
    panelMode: activeProject.panelMode,
    scrollSnapshots: activeProject.scrollSnapshots
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
        content: doc.content,
        saveIntentDirectory: doc.saveIntentDirectory ?? undefined
      })
    }
    projects.push({
      projectId,
      workspaceFolderPath: project.workspaceFolderPath,
      accentColor: project.accentColor,
      fileListSort: project.fileListSort,
      fileListGrouping: project.fileListGrouping,
      expandedFolderGroups: [...project.expandedFolderGroups],
      recentDocumentIds: [...project.recentDocumentIds],
      documents,
      currentDocumentId: project.currentDocumentId,
      chat: chatStateToPersisted(project.chat),
      panelMode: project.panelMode,
      scrollSnapshots: Object.fromEntries(project.scrollSnapshots.entries())
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
    editorFontSizePx: sanitizeFontSizePx(
      state.editorFontSizePx,
      DEFAULT_PREFERENCES_V1.editorFontSizePx
    ),
    previewFontSizePx: sanitizeFontSizePx(
      state.previewFontSizePx,
      DEFAULT_PREFERENCES_V1.previewFontSizePx
    ),
    recentsPaneWidthPx: state.recentsPaneWidthPx,
    markdownScanRelativeFolders: [...state.markdownScanRelativeFolders],
    excludeGitDirectory: state.excludeGitDirectory,
    excludeNodeModules: state.excludeNodeModules
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
