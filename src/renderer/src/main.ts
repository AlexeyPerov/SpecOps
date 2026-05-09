import type { SpecOpsPreloadApi } from '../../preload/specOpsApi'
import { createAppServices } from '../../app/services'
import { createAppStore } from '../../core/state/store'
import type { DocumentInput } from '../../core/state/types'
import { debounce } from '../../core/util/debounce'
import { attachPreviewChrome, mountPreview, previewErrorSnippet } from '../previewHost'

declare global {
  interface Window {
    specOps: SpecOpsPreloadApi
  }
}

const FIXTURE_MARKDOWN = `# Fixture

![](dot.png)

[Relative link](./readme.md)
`

const docA: DocumentInput = {
  id: 'doc-a',
  title: 'Doc A',
  content: '# Alpha\n\nHello **world**.\n\n![](https://httpbin.org/image/png)',
  path: null,
  lastModified: null
}

const docB: DocumentInput = {
  id: 'doc-b',
  title: 'Doc B',
  content: '# Bravo\n\nSecond document.\n\n[Example](https://example.com)',
  path: null,
  lastModified: null
}

const appRoot = document.querySelector<HTMLElement>('#app')
if (!appRoot) {
  throw new Error('#app missing')
}

appRoot.innerHTML = `
  <header class="toolbar">
    <button type="button" id="btn-open-a">Open A (explicit)</button>
    <button type="button" id="btn-open-b">Open B (explicit)</button>
    <button type="button" id="btn-activate-a">Activate A (recent list)</button>
    <button type="button" id="btn-fixture">Open fixture (disk path)</button>
    <span id="status-line" class="status-line"></span>
  </header>
  <div class="split">
    <textarea id="editor" aria-label="Markdown editor" spellcheck="false"></textarea>
    <div id="preview" class="preview-pane"></div>
  </div>
`

const editor = document.querySelector<HTMLTextAreaElement>('#editor')
const previewEl = document.querySelector<HTMLElement>('#preview')
const statusLine = document.querySelector<HTMLElement>('#status-line')

if (!editor || !previewEl || !statusLine) {
  throw new Error('shell markup incomplete')
}

attachPreviewChrome(previewEl)

const store = createAppStore()
const services = createAppServices()

let previewSeq = 0

async function runPreview(): Promise<void> {
  const seq = ++previewSeq
  const st = store.getState()
  const parseResult = services.parser.parse(st.editorContent)

  let html: string
  if (!parseResult.ok) {
    html = previewErrorSnippet(parseResult.error.message)
  } else {
    const rr = services.renderer.render(parseResult.ast)
    html = rr.ok ? rr.html : previewErrorSnippet(rr.error.message)
  }

  const docPath =
    st.currentDocumentId !== null ? st.documentsById.get(st.currentDocumentId)?.path ?? null : null

  if (seq !== previewSeq) return

  await mountPreview(previewEl, html, docPath, window.specOps)

  if (seq !== previewSeq) return
}

const schedulePreview = debounce(() => void runPreview(), 250)

store.subscribe(() => {
  const st = store.getState()
  if (editor.value !== st.editorContent) {
    editor.value = st.editorContent
  }
})

editor.addEventListener('input', () => {
  store.dispatch({ type: 'EDITOR_CHANGE', content: editor.value })
  schedulePreview()
})

document.querySelector('#btn-open-a')!.addEventListener('click', () => {
  store.dispatch({ type: 'OPEN_EXPLICIT', document: docA })
  schedulePreview.flush()
})

document.querySelector('#btn-open-b')!.addEventListener('click', () => {
  store.dispatch({ type: 'OPEN_EXPLICIT', document: docB })
  schedulePreview.flush()
})

document.querySelector('#btn-activate-a')!.addEventListener('click', () => {
  store.dispatch({ type: 'ACTIVATE_FROM_RECENT_LIST', documentId: 'doc-a' })
  schedulePreview.flush()
})

document.querySelector('#btn-fixture')!.addEventListener('click', () => {
  void (async () => {
    const docPath = await window.specOps.resolveRepoPath('fixtures', 'sample', 'readme.md')
    store.dispatch({
      type: 'OPEN_EXPLICIT',
      document: {
        id: 'fixture-sample',
        title: 'Fixture (NFR-08)',
        content: FIXTURE_MARKDOWN,
        path: docPath,
        lastModified: null
      }
    })
    schedulePreview.flush()
  })()
})

statusLine.textContent = [
  `${window.specOps.ping()} • v${window.specOps.getAppVersion()} • ${window.specOps.getPlatform()}`
].join('')

void runPreview()
