import type { SpecOpsPreloadApi } from '../../preload/specOpsApi'
import { markdownRendererIdFromEnv } from '../../app/markdownComposition'
import { createAppServices } from '../../app/services'
import { createAppStore } from '../../core/state/store'
import { createInitialAppState } from '../../core/state/transitions'
import {
  DEFAULT_PREFERENCES_V1,
  isRecoverableDraft,
  mergePreferencesIntoState,
  mergeSessionIntoState,
  refreshSessionDocumentsFromDisk,
  serializeSessionFromState,
  type PreferencesPersistedV1,
  type SessionPersistedV1
} from '../../core/state/sessionCodec'
import { bootRenderer } from '../boot/rendererBoot'
import { applyDocumentTheme } from '../theme/applyTheme'

declare global {
  interface Window {
    specOps?: SpecOpsPreloadApi
  }
}

function assertElectronBridge(): asserts window is Window & { specOps: SpecOpsPreloadApi } {
  const api = window.specOps
  if (
    !api ||
    typeof api.readPreferences !== 'function' ||
    typeof api.onMenuCommand !== 'function' ||
    typeof api.notifyPreferencesChanged !== 'function' ||
    typeof api.onPreferencesChanged !== 'function'
  ) {
    throw new Error(
      'The Electron preload bridge is missing (`window.specOps`). Open this app via Electron (`npm run dev` or `npm run preview`). If you opened the dev URL in an external browser only the renderer loads and native features cannot run.'
    )
  }
}

function sanitizeFontSizePx(value: number, fallback: number): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(24, Math.max(10, rounded))
}

function applyFontSizeVariables(prefs: PreferencesPersistedV1): void {
  const root = document.documentElement
  root.style.setProperty(
    '--font-size-code',
    `${sanitizeFontSizePx(prefs.editorFontSizePx, DEFAULT_PREFERENCES_V1.editorFontSizePx)}px`
  )
  root.style.setProperty(
    '--font-size-preview',
    `${sanitizeFontSizePx(prefs.previewFontSizePx, DEFAULT_PREFERENCES_V1.previewFontSizePx)}px`
  )
}

async function buildInitialState(): Promise<ReturnType<typeof createInitialAppState>> {
  let prefsRaw: unknown
  try {
    prefsRaw = await window.specOps.readPreferences()
  } catch {
    prefsRaw = null
  }
  const prefs: PreferencesPersistedV1 =
    prefsRaw && typeof prefsRaw === 'object'
      ? { ...DEFAULT_PREFERENCES_V1, ...(prefsRaw as PreferencesPersistedV1) }
      : DEFAULT_PREFERENCES_V1
  let state = mergePreferencesIntoState(createInitialAppState(), prefs)

  let sessionBlob: SessionPersistedV1 | null = null
  try {
    sessionBlob = await window.specOps.readSession()
  } catch {
    sessionBlob = null
  }

  if (sessionBlob && sessionBlob.version === 2 && sessionBlob.projects.length > 0) {
    const refreshedProjects = await Promise.all(
      sessionBlob.projects.map(async (project) => {
        const refreshed = await refreshSessionDocumentsFromDisk(project.documents, (p) =>
          window.specOps.readTextFile(p)
        )
        const surviving = new Set(refreshed.map((d) => d.id))
        const recentFiltered = project.recentDocumentIds.filter((id) => surviving.has(id))
        return {
          ...project,
          documents: refreshed,
          recentDocumentIds: recentFiltered
        }
      })
    )
    state = mergeSessionIntoState(state, {
      ...sessionBlob,
      projects: refreshedProjects
    })
  }

  return state
}

async function applyPreferencesFromDisk(store: ReturnType<typeof createAppStore>): Promise<void> {
  let prefsRaw: unknown
  try {
    prefsRaw = await window.specOps.readPreferences()
  } catch {
    return
  }
  const prefs: PreferencesPersistedV1 =
    prefsRaw && typeof prefsRaw === 'object'
      ? { ...DEFAULT_PREFERENCES_V1, ...(prefsRaw as PreferencesPersistedV1) }
      : DEFAULT_PREFERENCES_V1
  const st = store.getState()
  if (prefs.editorSoftWrap !== st.editorSoftWrap) {
    store.dispatch({ type: 'SET_EDITOR_SOFT_WRAP', enabled: prefs.editorSoftWrap })
  }
  if (prefs.editorLineNumbers !== st.editorLineNumbers) {
    store.dispatch({ type: 'SET_EDITOR_LINE_NUMBERS', enabled: prefs.editorLineNumbers })
  }
  if (prefs.editorFontSizePx !== st.editorFontSizePx) {
    store.dispatch({ type: 'SET_EDITOR_FONT_SIZE_PX', sizePx: prefs.editorFontSizePx })
  }
  if (prefs.previewFontSizePx !== st.previewFontSizePx) {
    store.dispatch({ type: 'SET_PREVIEW_FONT_SIZE_PX', sizePx: prefs.previewFontSizePx })
  }
  if (prefs.recentsPaneWidthPx !== st.recentsPaneWidthPx) {
    store.dispatch({ type: 'SET_RECENTS_PANE_WIDTH', widthPx: prefs.recentsPaneWidthPx })
  }
  if (prefs.themeMode !== st.themeMode) {
    store.dispatch({ type: 'SET_THEME_MODE', mode: prefs.themeMode })
  }
  if (prefs.autosaveEnabled !== st.autosaveEnabled) {
    store.dispatch({ type: 'SET_AUTOSAVE_ENABLED', enabled: prefs.autosaveEnabled })
  }
  if (
    JSON.stringify([...prefs.markdownScanRelativeFolders]) !==
    JSON.stringify([...st.markdownScanRelativeFolders])
  ) {
    store.dispatch({
      type: 'SET_MARKDOWN_SCAN_RELATIVE_FOLDERS',
      folders: prefs.markdownScanRelativeFolders
    })
  }
  applyDocumentTheme(store.getState().themeMode)
  applyFontSizeVariables(prefs)
}

async function maybeRecoverDraft(store: ReturnType<typeof createAppStore>): Promise<void> {
  const cid = store.getState().currentDocumentId
  if (!cid) return
  let draft: Awaited<ReturnType<SpecOpsPreloadApi['readDraft']>>
  try {
    draft = await window.specOps.readDraft(cid)
  } catch {
    draft = null
  }
  const baseline = store.getState().editorContent
  if (!draft || !isRecoverableDraft(baseline, draft.content)) return

  const choice = await window.specOps.promptDraftRecovery()
  if (choice === 'recover') {
    store.dispatch({ type: 'EDITOR_CHANGE', content: draft.content })
  }
  await window.specOps.clearDraft(cid)
}

async function bootstrap(): Promise<void> {
  const appRoot = document.querySelector<HTMLElement>('#app')
  if (!appRoot) {
    throw new Error('#app missing')
  }

  assertElectronBridge()

  const initial = await buildInitialState()
  const store = createAppStore(initial)

  await maybeRecoverDraft(store)

  const services = createAppServices({
    markdownRenderer: markdownRendererIdFromEnv(import.meta.env.VITE_MARKDOWN_RENDERER)
  })

  bootRenderer({
    root: appRoot,
    store,
    services,
    specOps: window.specOps
  })

  applyDocumentTheme(store.getState().themeMode)
  applyFontSizeVariables(DEFAULT_PREFERENCES_V1)
  void applyPreferencesFromDisk(store)

  window.specOps.onPreferencesChanged(() => {
    void applyPreferencesFromDisk(store)
  })

  window.addEventListener('beforeunload', () => {
    void window.specOps.writeSession(serializeSessionFromState(store.getState()))
  })
}

void bootstrap().catch((err) => {
  console.error(err)
  const appRoot = document.querySelector<HTMLElement>('#app')
  if (appRoot) {
    appRoot.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`
  }
})
