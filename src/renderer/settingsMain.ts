import './theme/app.css'
import {
  DEFAULT_PREFERENCES_V1,
  type PreferencesPersistedV1
} from '../core/state/sessionCodec'
import { applyDocumentTheme } from './theme/applyTheme'
import type { SpecOpsPreloadApi } from '../preload/specOpsApi'

declare global {
  interface Window {
    specOps?: SpecOpsPreloadApi
  }
}

function assertSpecOps(): asserts window is Window & { specOps: SpecOpsPreloadApi } {
  if (!window.specOps) throw new Error('specOps bridge missing')
}

function bindSystemThemeListener(themeMode: PreferencesPersistedV1['themeMode'], scheduleApply: () => void): void {
  const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
  if (!mq?.addEventListener) return
  mq.addEventListener('change', () => {
    if (themeMode === 'system') scheduleApply()
  })
}

async function boot(): Promise<void> {
  assertSpecOps()
  const specOps = window.specOps
  const prefsRaw = await specOps.readPreferences()
  const prefs: PreferencesPersistedV1 = {
    ...DEFAULT_PREFERENCES_V1,
    ...(prefsRaw as Partial<PreferencesPersistedV1>)
  }

  const applyTheme = () => {
    applyDocumentTheme(prefs.themeMode)
  }
  applyTheme()
  bindSystemThemeListener(prefs.themeMode, applyTheme)

  const wrapEl = document.querySelector<HTMLInputElement>('#setting-wrap')!
  const lineNumbersEl = document.querySelector<HTMLInputElement>('#setting-line-numbers')!
  wrapEl.checked = prefs.editorSoftWrap
  lineNumbersEl.checked = prefs.editorLineNumbers

  const persist = async (): Promise<void> => {
    const latest = await specOps.readPreferences()
    const base: PreferencesPersistedV1 = {
      ...DEFAULT_PREFERENCES_V1,
      ...(latest as Partial<PreferencesPersistedV1>)
    }
    await specOps.writePreferences({
      ...base,
      editorSoftWrap: wrapEl.checked,
      editorLineNumbers: lineNumbersEl.checked
    })
    specOps.notifyPreferencesChanged()
  }

  wrapEl.addEventListener('change', () => void persist())
  lineNumbersEl.addEventListener('change', () => void persist())
}

void boot().catch((err) => {
  console.error(err)
  document.body.textContent = err instanceof Error ? err.message : String(err)
})
