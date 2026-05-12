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
import { bindThemeControls } from '../theme/bindTheme'

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

  if (sessionBlob && sessionBlob.version === 1 && sessionBlob.documents.length > 0) {
    const refreshed = await refreshSessionDocumentsFromDisk(sessionBlob.documents, (p) =>
      window.specOps.readTextFile(p)
    )
    const surviving = new Set(refreshed.map((d) => d.id))
    const recentFiltered = sessionBlob.recentDocumentIds.filter((id) => surviving.has(id))
    state = mergeSessionIntoState(state, {
      ...sessionBlob,
      documents: refreshed,
      recentDocumentIds: recentFiltered
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
  if (prefs.recentsPaneWidthPx !== st.recentsPaneWidthPx) {
    store.dispatch({ type: 'SET_RECENTS_PANE_WIDTH', widthPx: prefs.recentsPaneWidthPx })
  }
  if (prefs.themeMode !== st.themeMode) {
    store.dispatch({ type: 'SET_THEME_MODE', mode: prefs.themeMode })
  }
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

  bindThemeControls(appRoot, store)

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
