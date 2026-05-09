import type { SpecOpsPreloadApi } from '../../preload/specOpsApi'
import { createAppServices } from '../../app/services'

declare global {
  interface Window {
    specOps: SpecOpsPreloadApi
  }
}

const appEl = document.querySelector<HTMLElement>('#app')
if (!appEl) {
  throw new Error('#app missing')
}

const { parser, renderer } = createAppServices()
const parseResult = parser.parse('# stub')
const renderResult = parseResult.ok ? renderer.render(parseResult.ast) : null

const bridge = [
  `ping: ${window.specOps.ping()}`,
  `version: ${window.specOps.getAppVersion()}`,
  `platform: ${window.specOps.getPlatform()}`,
  `markdown pipeline: parse ok=${parseResult.ok} render ok=${renderResult?.ok === true}`
].join('\n')

appEl.style.fontFamily = 'system-ui, sans-serif'
appEl.style.whiteSpace = 'pre-wrap'
appEl.style.padding = '1rem'
appEl.textContent = bridge
