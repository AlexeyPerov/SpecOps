import type { AppState, Document } from './types'

/** Mirrors main-process persisted preferences JSON v1. */
export interface PreferencesPersistedV1 {
  readonly version: 1
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

export interface SessionPersistedV1 {
  readonly version: 1
  readonly recentDocumentIds: readonly string[]
  readonly documents: readonly SessionDocumentPersistedV1[]
  readonly currentDocumentId: string | null
}

export const DEFAULT_PREFERENCES_V1: PreferencesPersistedV1 = {
  version: 1,
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
  return {
    ...base,
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
  const documentsById = new Map<string, Document>()
  const seen = new Set<string>()
  for (const d of session.documents) {
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

  const recentDocumentIds = session.recentDocumentIds.filter((id) => documentsById.has(id))
  let currentDocumentId =
    session.currentDocumentId !== null && documentsById.has(session.currentDocumentId)
      ? session.currentDocumentId
      : recentDocumentIds[0] ?? null

  const editorContent =
    currentDocumentId !== null ? documentsById.get(currentDocumentId)?.content ?? '' : ''

  return {
    ...base,
    documentsById,
    recentDocumentIds,
    currentDocumentId,
    editorContent
  }
}

/** Snapshot baseline documents + ordering for session.json (Document.content = saved baseline). */
export function serializeSessionFromState(state: AppState): SessionPersistedV1 {
  const documents: SessionDocumentPersistedV1[] = []
  const seen = new Set<string>()
  for (const id of state.recentDocumentIds) {
    const doc = state.documentsById.get(id)
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
  return {
    version: 1,
    recentDocumentIds: [...state.recentDocumentIds],
    documents,
    currentDocumentId: state.currentDocumentId
  }
}

/** Preferences snapshot derived from AppState. */
export function serializePreferencesFromState(state: AppState): PreferencesPersistedV1 {
  return {
    version: 1,
    themeMode: state.themeMode,
    fileListSort: state.fileListSort,
    fileListGrouping: state.fileListGrouping,
    expandedFolderGroups: [...state.expandedFolderGroups],
    workspaceFolderPath: state.workspaceFolderPath,
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
