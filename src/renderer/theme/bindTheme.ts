import type { AppStore } from '../../core/state/store'
import type { ThemeMode } from '../../core/state/types'
import { applyDocumentTheme } from './applyTheme'
import { getThemeControlsSlot } from '../boot/rendererBoot'

function bindSystemThemeListener(store: AppStore, scheduleApply: () => void): void {
  const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
  if (!mq?.addEventListener) return
  mq.addEventListener('change', () => {
    if (store.getState().themeMode === 'system') scheduleApply()
  })
}

/** Toolbar theme select + document `data-theme` sync (`FR-17`–`FR-18`). */
export function bindThemeControls(appRoot: HTMLElement, store: AppStore): void {
  const slot = getThemeControlsSlot(appRoot)
  if (!slot || !globalThis.document) return

  const wrap = document.createElement('label')
  wrap.className = 'theme-select-label'
  wrap.textContent = 'Theme '

  const select = document.createElement('select')
  select.className = 'theme-select'
  select.setAttribute('aria-label', 'Theme')
  for (const mode of ['system', 'light', 'dark'] as const) {
    const opt = document.createElement('option')
    opt.value = mode
    opt.textContent = mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark'
    select.appendChild(opt)
  }

  const syncSelect = () => {
    select.value = store.getState().themeMode
  }

  const apply = () => {
    applyDocumentTheme(store.getState().themeMode)
    syncSelect()
  }

  select.addEventListener('change', () => {
    const mode = select.value as ThemeMode
    store.dispatch({ type: 'SET_THEME_MODE', mode })
    apply()
  })

  wrap.appendChild(select)
  slot.appendChild(wrap)

  store.subscribe(apply)
  bindSystemThemeListener(store, apply)
  apply()
}
