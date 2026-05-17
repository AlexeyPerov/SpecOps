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

function sanitizeFontSizePx(value: number, fallback: number): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(24, Math.max(10, rounded))
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
  const editorFontSizeEl = document.querySelector<HTMLInputElement>('#setting-editor-font-size')!
  const previewFontSizeEl = document.querySelector<HTMLInputElement>('#setting-preview-font-size')!
  const clearProjectsBtn = document.querySelector<HTMLButtonElement>('#clear-projects')!
  const scanFoldersEl = document.querySelector<HTMLTextAreaElement>('#setting-scan-folders')!
  const excludeGitEl = document.querySelector<HTMLInputElement>('#setting-exclude-git')!
  const excludeNodeModulesEl = document.querySelector<HTMLInputElement>('#setting-exclude-node-modules')!
  wrapEl.checked = prefs.editorSoftWrap
  autosaveEl.checked = prefs.autosaveEnabled
  themeEl.value = prefs.themeMode
  const applyTheme = () => applyDocumentTheme(themeEl.value as PreferencesPersistedV1['themeMode'])
  applyTheme()
  bindSystemThemeListener(themeEl.value as PreferencesPersistedV1['themeMode'], applyTheme)
  lineNumbersEl.checked = prefs.editorLineNumbers
  editorFontSizeEl.value = String(
    sanitizeFontSizePx(prefs.editorFontSizePx, DEFAULT_PREFERENCES_V1.editorFontSizePx)
  )
  previewFontSizeEl.value = String(
    sanitizeFontSizePx(prefs.previewFontSizePx, DEFAULT_PREFERENCES_V1.previewFontSizePx)
  )
  scanFoldersEl.value = prefs.markdownScanRelativeFolders.join('\n')
  excludeGitEl.checked = prefs.excludeGitDirectory ?? true
  excludeNodeModulesEl.checked = prefs.excludeNodeModules ?? true

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
      editorFontSizePx: sanitizeFontSizePx(
        Number(editorFontSizeEl.value),
        DEFAULT_PREFERENCES_V1.editorFontSizePx
      ),
      previewFontSizePx: sanitizeFontSizePx(
        Number(previewFontSizeEl.value),
        DEFAULT_PREFERENCES_V1.previewFontSizePx
      ),
      markdownScanRelativeFolders: [...sanitizeMarkdownScanFolderLines(scanFoldersEl.value)],
      excludeGitDirectory: excludeGitEl.checked,
      excludeNodeModules: excludeNodeModulesEl.checked
    })
    applyDocumentTheme(themeEl.value as PreferencesPersistedV1['themeMode'])
    specOps.notifyPreferencesChanged()
  }

  autosaveEl.addEventListener('change', () => void persist())
  themeEl.addEventListener('change', () => void persist())
  wrapEl.addEventListener('change', () => void persist())
  lineNumbersEl.addEventListener('change', () => void persist())
  editorFontSizeEl.addEventListener('change', () => void persist())
  previewFontSizeEl.addEventListener('change', () => void persist())
  scanFoldersEl.addEventListener('change', () => void persist())
  excludeGitEl.addEventListener('change', () => void persist())
  excludeNodeModulesEl.addEventListener('change', () => void persist())
  clearProjectsBtn.addEventListener('click', () => {
    void (async () => {
      const confirmed = window.confirm('Clear all added projects and keep only Notepad?')
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
