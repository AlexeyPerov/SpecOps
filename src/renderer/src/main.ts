import type { SpecOpsPreloadApi } from '../../preload/specOpsApi'
import { markdownRendererIdFromEnv } from '../../app/markdownComposition'
import { createAppServices } from '../../app/services'
import { createAppStore } from '../../core/state/store'
import { bootRenderer } from '../boot/rendererBoot'
import { bindThemeControls } from '../theme/bindTheme'

declare global {
  interface Window {
    specOps: SpecOpsPreloadApi
  }
}

const appRoot = document.querySelector<HTMLElement>('#app')
if (!appRoot) {
  throw new Error('#app missing')
}

const store = createAppStore()
// Allowed `VITE_MARKDOWN_RENDERER`: `html` (default), `astJson` (debug AST preview).
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
