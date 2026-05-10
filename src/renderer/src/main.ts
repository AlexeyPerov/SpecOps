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
    specOps: SpecOpsPreloadApi
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
