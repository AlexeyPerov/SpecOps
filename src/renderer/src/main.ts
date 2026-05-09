import type { SpecOpsPreloadApi } from '../../preload/specOpsApi'
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
const services = createAppServices()

bootRenderer({
  root: appRoot,
  store,
  services,
  specOps: window.specOps
})

bindThemeControls(appRoot, store)
