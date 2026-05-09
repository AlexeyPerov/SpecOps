import type { SpecOpsPreloadApi } from '../../preload/specOpsApi'
import type { AppServices } from '../../app/services'
import type { AppStore } from '../../core/state/store'
import type { DocumentInput } from '../../core/state/types'
import { debounce } from '../../core/util/debounce'
import { attachPreviewChrome, mountPreview, previewErrorSnippet } from '../previewHost'

export interface RendererBootContext {
  readonly root: HTMLElement
  readonly store: AppStore
  readonly services: AppServices
  readonly specOps: SpecOpsPreloadApi
}

const FIXTURE_MARKDOWN = `# Fixture

![](dot.png)

[Relative link](./readme.md)
`

const SAMPLE_DOC_A: DocumentInput = {
  id: 'doc-a',
  title: 'Doc A',
  content: '# Alpha\n\nHello **world**.\n\n![](missing-local.png)\n',
  path: null,
  lastModified: null
}

const SAMPLE_DOC_B: DocumentInput = {
  id: 'doc-b',
  title: 'Doc B',
  content: '# Bravo\n\nSecond document.\n\n[Example](https://example.com)\n',
  path: null,
  lastModified: null
}

function renderRecents(listEl: HTMLElement, rootEl: HTMLElement, store: AppStore): void {
  const state = store.getState()
  listEl.innerHTML = ''

  if (!state.recentDocumentIds.length) {
    const li = document.createElement('li')
    li.className = 'recents-empty'
    li.textContent = 'No documents yet'
    listEl.appendChild(li)
    return
  }

  for (const id of state.recentDocumentIds) {
    const doc = state.documentsById.get(id)
    const label = doc?.title?.trim() || id

    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'recent-item'
    btn.dataset.recentDocId = id
    btn.textContent = label

    if (state.currentDocumentId === id) {
      btn.setAttribute('aria-current', 'true')
      btn.classList.add('recent-item--selected')
    }

    li.appendChild(btn)
    listEl.appendChild(li)
  }

  rootEl.dataset.currentDocId = state.currentDocumentId ?? ''
}

/** Wire SpeOps renderer shell (UPH-01 three-pane). */
export function bootRenderer(ctx: RendererBootContext): void {
  const { root, store, services, specOps } = ctx

  root.innerHTML = `
    <header class="app-toolbar" role="banner">
      <button type="button" id="btn-seed-demos" class="toolbar-btn">Seed demo documents</button>
      <button type="button" id="btn-open-fixture" class="toolbar-btn">Open fixture sample</button>
      <span id="theme-controls-slot"></span>
      <span id="status-line" class="status-line"></span>
    </header>
    <div class="app-body">
      <aside data-testid="recents-pane" class="recents-pane" aria-label="Recent documents">
        <div class="recents-heading">Recents</div>
        <ul data-testid="recents-list" class="recents-list" role="list"></ul>
      </aside>
      <div class="workspace">
        <div class="editor-pane">
          <textarea data-testid="editor" id="editor" class="editor-field" aria-label="Markdown editor" spellcheck="false"></textarea>
        </div>
        <div data-testid="preview" id="preview" class="preview-pane"></div>
      </div>
    </div>
  `

  const editor = root.querySelector<HTMLTextAreaElement>('#editor')!
  const previewEl = root.querySelector<HTMLElement>('#preview')!
  const recentsList = root.querySelector<HTMLElement>('[data-testid="recents-list"]')!
  const statusLine = root.querySelector<HTMLElement>('#status-line')!

  attachPreviewChrome(previewEl)

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

    await mountPreview(previewEl, html, docPath, specOps)

    if (seq !== previewSeq) return
  }

  const schedulePreview = debounce(() => void runPreview(), 250)

  store.subscribe(() => {
    const st = store.getState()
    if (editor.value !== st.editorContent) {
      editor.value = st.editorContent
    }
    renderRecents(recentsList, root, store)
  })

  renderRecents(recentsList, root, store)

  editor.addEventListener('input', () => {
    store.dispatch({ type: 'EDITOR_CHANGE', content: editor.value })
    schedulePreview()
  })

  recentsList.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    const btn = target?.closest<HTMLButtonElement>('button[data-recent-doc-id]')
    if (!btn?.dataset.recentDocId) return
    store.dispatch({ type: 'ACTIVATE_FROM_RECENT_LIST', documentId: btn.dataset.recentDocId })
    requestAnimationFrame(() => schedulePreview.flush())
  })

  root.querySelector('#btn-seed-demos')!.addEventListener('click', () => {
    const t0 = new Date().toISOString()
    store.dispatch({ type: 'OPEN_EXPLICIT', document: SAMPLE_DOC_B }, t0)
    store.dispatch({ type: 'OPEN_EXPLICIT', document: SAMPLE_DOC_A }, t0)
    schedulePreview.flush()
  })

  root.querySelector('#btn-open-fixture')!.addEventListener('click', () => {
    void (async () => {
      const docPath = await specOps.resolveRepoPath('fixtures', 'sample', 'readme.md')
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

  statusLine.textContent = `${specOps.ping()} • v${specOps.getAppVersion()} • ${specOps.getPlatform()}`

  void runPreview()
}

/** Resolve toolbar slot for theme control (Task 10). */
export function getThemeControlsSlot(root: HTMLElement): HTMLElement | null {
  return root.querySelector('#theme-controls-slot')
}
