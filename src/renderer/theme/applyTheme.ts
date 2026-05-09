import type { ThemeMode } from '../../core/state/types'

/** Resolved palette applied on `:root` as `data-theme`. */
export function resolveEffectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

export function applyDocumentTheme(mode: ThemeMode): void {
  const doc = globalThis.document?.documentElement
  if (!doc) return
  doc.dataset.theme = resolveEffectiveTheme(mode)
}
