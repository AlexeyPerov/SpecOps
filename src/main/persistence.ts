import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BrowserWindow, dialog, ipcMain, type App } from 'electron'

import type {
  PreferencesPersistedV1 as PersistedPreferencesV1,
  SessionDocumentPersistedV1 as PersistedSessionDocumentV1,
  SessionPersistedV1 as PersistedSessionV1
} from '../core/state/sessionCodec'
import { DEFAULT_PREFERENCES_V1 } from '../core/state/sessionCodec'

export type { PersistedPreferencesV1, PersistedSessionDocumentV1, PersistedSessionV1 }

export interface PersistedDraftV1 {
  readonly version: 1
  readonly documentId: string
  readonly content: string
  readonly updatedAtIso: string
}

export { DEFAULT_PREFERENCES_V1 }

function persistenceRoot(app: App): string {
  return join(app.getPath('userData'), 'specops')
}

function prefsPath(app: App): string {
  return join(persistenceRoot(app), 'preferences.json')
}

function sessionPath(app: App): string {
  return join(persistenceRoot(app), 'session.json')
}

function draftsDir(app: App): string {
  return join(persistenceRoot(app), 'drafts')
}

function draftPath(app: App, documentId: string): string {
  const safe = documentId.replace(/[/\\:]/g, '_')
  return join(draftsDir(app), `${safe}.json`)
}

async function atomicWriteJson(targetPath: string, value: unknown): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  const tmp = `${targetPath}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 0)}\n`, 'utf8')
  await rename(tmp, targetPath)
}

function clampRecentsPaneWidthPx(raw: unknown): number {
  const x = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN
  if (!Number.isFinite(x)) return DEFAULT_PREFERENCES_V1.recentsPaneWidthPx
  return Math.min(560, Math.max(180, Math.round(x)))
}

function parsePreferences(raw: string): PersistedPreferencesV1 {
  try {
    const o = JSON.parse(raw) as Partial<PersistedPreferencesV1>
    if (o.version !== undefined && o.version !== 1) return DEFAULT_PREFERENCES_V1
    const themeMode =
      o.themeMode === 'light' || o.themeMode === 'dark' || o.themeMode === 'system'
        ? o.themeMode
        : DEFAULT_PREFERENCES_V1.themeMode
    const fileListSort =
      o.fileListSort === 'lastOpened' || o.fileListSort === 'title' || o.fileListSort === 'path'
        ? o.fileListSort
        : DEFAULT_PREFERENCES_V1.fileListSort
    const fileListGrouping = o.fileListGrouping === 'folder' ? 'folder' : 'none'
    const expandedFolderGroups = Array.isArray(o.expandedFolderGroups)
      ? o.expandedFolderGroups.filter((x): x is string => typeof x === 'string')
      : []
    const workspaceFolderPath =
      typeof o.workspaceFolderPath === 'string' || o.workspaceFolderPath === null
        ? o.workspaceFolderPath
        : null
    return {
      version: 1,
      themeMode,
      fileListSort,
      fileListGrouping,
      expandedFolderGroups,
      workspaceFolderPath,
      autosaveEnabled: typeof o.autosaveEnabled === 'boolean' ? o.autosaveEnabled : false,
      editorSoftWrap: typeof o.editorSoftWrap === 'boolean' ? o.editorSoftWrap : true,
      editorLineNumbers: typeof o.editorLineNumbers === 'boolean' ? o.editorLineNumbers : true,
      recentsPaneWidthPx: clampRecentsPaneWidthPx(o.recentsPaneWidthPx)
    }
  } catch {
    return DEFAULT_PREFERENCES_V1
  }
}

function parseSession(raw: string): PersistedSessionV1 | null {
  try {
    const o = JSON.parse(raw) as Partial<PersistedSessionV1>
    if (o.version !== 1 || !Array.isArray(o.documents) || !Array.isArray(o.recentDocumentIds)) {
      return null
    }
    const documents = o.documents
      .filter((d): d is PersistedSessionDocumentV1 => {
        return (
          typeof d === 'object' &&
          d !== null &&
          typeof (d as PersistedSessionDocumentV1).id === 'string' &&
          typeof (d as PersistedSessionDocumentV1).title === 'string' &&
          typeof (d as PersistedSessionDocumentV1).content === 'string' &&
          typeof (d as PersistedSessionDocumentV1).lastOpened === 'string'
        )
      })
      .map((d) => ({
        id: d.id,
        title: d.title,
        path: typeof d.path === 'string' || d.path === null ? d.path : null,
        lastModified: typeof d.lastModified === 'string' || d.lastModified === null ? d.lastModified : null,
        lastOpened: d.lastOpened,
        content: d.content
      }))
    const recentDocumentIds = o.recentDocumentIds.filter((id): id is string => typeof id === 'string')
    const currentDocumentId =
      typeof o.currentDocumentId === 'string' || o.currentDocumentId === null
        ? o.currentDocumentId
        : null
    return { version: 1, recentDocumentIds, documents, currentDocumentId }
  } catch {
    return null
  }
}

export async function readPreferencesFile(app: App): Promise<PersistedPreferencesV1> {
  try {
    const raw = await readFile(prefsPath(app), 'utf8')
    return parsePreferences(raw)
  } catch {
    return DEFAULT_PREFERENCES_V1
  }
}

export async function writePreferencesFile(
  app: App,
  prefs: PersistedPreferencesV1
): Promise<void> {
  await atomicWriteJson(prefsPath(app), prefs)
}

export async function readSessionFile(app: App): Promise<PersistedSessionV1 | null> {
  try {
    const raw = await readFile(sessionPath(app), 'utf8')
    return parseSession(raw)
  } catch {
    return null
  }
}

export async function writeSessionFile(app: App, session: PersistedSessionV1): Promise<void> {
  await atomicWriteJson(sessionPath(app), session)
}

export async function readDraftFile(app: App, documentId: string): Promise<PersistedDraftV1 | null> {
  try {
    const raw = await readFile(draftPath(app, documentId), 'utf8')
    const o = JSON.parse(raw) as Partial<PersistedDraftV1>
    if (
      o.version !== 1 ||
      typeof o.documentId !== 'string' ||
      typeof o.content !== 'string' ||
      typeof o.updatedAtIso !== 'string'
    ) {
      return null
    }
    return {
      version: 1,
      documentId: o.documentId,
      content: o.content,
      updatedAtIso: o.updatedAtIso
    }
  } catch {
    return null
  }
}

export async function writeDraftFile(
  app: App,
  draft: Omit<PersistedDraftV1, 'version'>
): Promise<void> {
  const payload: PersistedDraftV1 = {
    version: 1,
    documentId: draft.documentId,
    content: draft.content,
    updatedAtIso: draft.updatedAtIso
  }
  await mkdir(draftsDir(app), { recursive: true })
  await atomicWriteJson(draftPath(app, draft.documentId), payload)
}

export async function clearDraftFile(app: App, documentId: string): Promise<void> {
  try {
    await unlink(draftPath(app, documentId))
  } catch {
    /* ignore */
  }
}

export async function listDraftDocumentIds(app: App): Promise<string[]> {
  try {
    const names = await readdir(draftsDir(app))
    return names
      .filter((n) => n.endsWith('.json'))
      .map((n) => n.replace(/\.json$/, ''))
  } catch {
    return []
  }
}

export type DraftRecoveryChoice = 'recover' | 'discard'

export function registerPersistenceIpc(app: App): void {
  ipcMain.handle('specops:read-preferences', async () => readPreferencesFile(app))

  ipcMain.handle('specops:write-preferences', async (_evt, prefs: unknown) => {
    const base = await readPreferencesFile(app)
    const p = prefs as Partial<PersistedPreferencesV1>
    const merged: PersistedPreferencesV1 = {
      version: 1,
      themeMode:
        p.themeMode === 'light' || p.themeMode === 'dark' || p.themeMode === 'system'
          ? p.themeMode
          : base.themeMode,
      fileListSort:
        p.fileListSort === 'lastOpened' || p.fileListSort === 'title' || p.fileListSort === 'path'
          ? p.fileListSort
          : base.fileListSort,
      fileListGrouping:
        p.fileListGrouping === 'folder'
          ? 'folder'
          : p.fileListGrouping === 'none'
            ? 'none'
            : base.fileListGrouping,
      expandedFolderGroups: Array.isArray(p.expandedFolderGroups)
        ? p.expandedFolderGroups.filter((x): x is string => typeof x === 'string')
        : [...base.expandedFolderGroups],
      workspaceFolderPath:
        typeof p.workspaceFolderPath === 'string' || p.workspaceFolderPath === null
          ? p.workspaceFolderPath
          : base.workspaceFolderPath,
      autosaveEnabled:
        typeof p.autosaveEnabled === 'boolean' ? p.autosaveEnabled : base.autosaveEnabled,
      editorSoftWrap:
        typeof p.editorSoftWrap === 'boolean' ? p.editorSoftWrap : base.editorSoftWrap,
      editorLineNumbers:
        typeof p.editorLineNumbers === 'boolean' ? p.editorLineNumbers : base.editorLineNumbers,
      recentsPaneWidthPx:
        p.recentsPaneWidthPx !== undefined && p.recentsPaneWidthPx !== null
          ? clampRecentsPaneWidthPx(p.recentsPaneWidthPx)
          : base.recentsPaneWidthPx
    }
    await writePreferencesFile(app, merged)
  })

  ipcMain.handle('specops:read-session', async () => readSessionFile(app))

  ipcMain.handle('specops:write-session', async (_evt, session: unknown) => {
    const s = session as PersistedSessionV1
    if (!s || s.version !== 1) return
    await writeSessionFile(app, s)
  })

  ipcMain.handle('specops:read-draft', async (_evt, documentId: unknown) => {
    if (typeof documentId !== 'string' || !documentId) return null
    return readDraftFile(app, documentId)
  })

  ipcMain.handle(
    'specops:write-draft',
    async (_evt, payload: { documentId: unknown; content: unknown }) => {
      const documentId = typeof payload?.documentId === 'string' ? payload.documentId : ''
      const content = typeof payload?.content === 'string' ? payload.content : null
      if (!documentId || content === null) return
      await writeDraftFile(app, {
        documentId,
        content,
        updatedAtIso: new Date().toISOString()
      })
    }
  )

  ipcMain.handle('specops:clear-draft', async (_evt, documentId: unknown) => {
    if (typeof documentId !== 'string' || !documentId) return
    await clearDraftFile(app, documentId)
  })

  ipcMain.handle('specops:list-draft-ids', async () => listDraftDocumentIds(app))

  ipcMain.handle('specops:prompt-draft-recovery', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return 'discard' as DraftRecoveryChoice
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Recover unsaved changes?',
      message:
        'A recoverable draft was found for this document. Restore unsaved edits from the last session?',
      buttons: ['Recover', 'Discard draft'],
      defaultId: 0,
      cancelId: 1
    })
    return response === 0 ? ('recover' as const) : ('discard' as const)
  })
}
