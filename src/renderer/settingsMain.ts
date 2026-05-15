import './theme/app.css'
import {
  DEFAULT_PREFERENCES_V1,
  type PreferencesPersistedV1
} from '../core/state/sessionCodec'
import { sanitizeMarkdownScanFolderLines } from '../core/util/markdownScanFolders'
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
    if (
      (document.querySelector<HTMLSelectElement>('#setting-theme')?.value ??
        themeMode) === 'system'
    ) {
      scheduleApply()
    }
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

  const wrapEl = document.querySelector<HTMLInputElement>('#setting-wrap')!
  const autosaveEl = document.querySelector<HTMLInputElement>('#setting-autosave')!
  const themeEl = document.querySelector<HTMLSelectElement>('#setting-theme')!
  const lineNumbersEl = document.querySelector<HTMLInputElement>('#setting-line-numbers')!
  const clearProjectsBtn = document.querySelector<HTMLButtonElement>('#clear-projects')!
  const scanFoldersEl = document.querySelector<HTMLTextAreaElement>('#setting-scan-folders')!
  wrapEl.checked = prefs.editorSoftWrap
  autosaveEl.checked = prefs.autosaveEnabled
  themeEl.value = prefs.themeMode
  const applyTheme = () => applyDocumentTheme(themeEl.value as PreferencesPersistedV1['themeMode'])
  applyTheme()
  bindSystemThemeListener(themeEl.value as PreferencesPersistedV1['themeMode'], applyTheme)
  lineNumbersEl.checked = prefs.editorLineNumbers
  scanFoldersEl.value = prefs.markdownScanRelativeFolders.join('\n')

  const persist = async (): Promise<void> => {
    const latest = await specOps.readPreferences()
    const base: PreferencesPersistedV1 = {
      ...DEFAULT_PREFERENCES_V1,
      ...(latest as Partial<PreferencesPersistedV1>)
    }
    await specOps.writePreferences({
      ...base,
      themeMode: themeEl.value as PreferencesPersistedV1['themeMode'],
      autosaveEnabled: autosaveEl.checked,
      editorSoftWrap: wrapEl.checked,
      editorLineNumbers: lineNumbersEl.checked,
      markdownScanRelativeFolders: [...sanitizeMarkdownScanFolderLines(scanFoldersEl.value)]
    })
    applyDocumentTheme(themeEl.value as PreferencesPersistedV1['themeMode'])
    specOps.notifyPreferencesChanged()
  }

  autosaveEl.addEventListener('change', () => void persist())
  themeEl.addEventListener('change', () => void persist())
  wrapEl.addEventListener('change', () => void persist())
  lineNumbersEl.addEventListener('change', () => void persist())
  scanFoldersEl.addEventListener('change', () => void persist())
  clearProjectsBtn.addEventListener('click', () => {
    void (async () => {
      const confirmed = window.confirm('Clear all added projects and keep only the default project?')
      if (!confirmed) return
      await specOps.clearProjects()
      window.alert('Projects list cleared.')
    })()
  })
}

void boot().catch((err) => {
  console.error(err)
  document.body.textContent = err instanceof Error ? err.message : String(err)
})
