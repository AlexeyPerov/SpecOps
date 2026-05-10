import type { SpecOpsPreloadApi } from '../../preload/specOpsApi'
import type { AppServices } from '../../app/services'
import type { AppStore } from '../../core/state/store'
import type { DocumentInput } from '../../core/state/types'
import { debounce } from '../../core/util/debounce'
import {
  documentIdForAbsolutePath,
  groupsForPresentation,
  isEditorDirty,
  isFolderExpanded
} from '../../core/state/fileListPresentation'
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

function pathBasename(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  return i >= 0 ? norm.slice(i + 1) : norm
}

function stableDocIdForPath(absolutePath: string): string {
  return absolutePath.replace(/\\/g, '/')
}

function triggerWorkspaceMotion(workspaceEl: HTMLElement): void {
  const msRaw = getComputedStyle(workspaceEl).getPropertyValue('--motion-file-switch-ms').trim()
  const ms = parseFloat(msRaw) || 180
  workspaceEl.classList.remove('workspace--transition')
  requestAnimationFrame(() => {
    workspaceEl.classList.add('workspace--transition')
    window.setTimeout(() => workspaceEl.classList.remove('workspace--transition'), ms)
  })
}

function renderRecents(listRoot: HTMLElement, store: AppStore): void {
  const state = store.getState()
  listRoot.innerHTML = ''

  if (!state.recentDocumentIds.length) {
    const empty = document.createElement('div')
    empty.className = 'recents-empty'
    empty.textContent = 'No documents yet'
    listRoot.appendChild(empty)
    return
  }

  const groups = groupsForPresentation(state)

  if (state.fileListGrouping === 'none') {
    const flat = groups[0]
    const ul = document.createElement('ul')
    ul.className = 'recent-items'
    ul.setAttribute('role', 'list')
    for (const id of flat.ids) appendRecentRow(ul, id, state)
    listRoot.appendChild(ul)
    return
  }

  const wrap = document.createElement('div')
  wrap.className = 'recent-groups'
  for (const g of groups) {
    const section = document.createElement('section')
    section.className = 'recent-group'
    section.dataset.folderKey = g.key

    const headerBtn = document.createElement('button')
    headerBtn.type = 'button'
    headerBtn.className = 'recent-group-header'
    headerBtn.dataset.folderKey = g.key
    const expanded = isFolderExpanded(state, g.key)
    headerBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false')
    headerBtn.innerHTML = `<span class="recent-group-chevron">${expanded ? '▾' : '▸'}</span><span class="recent-group-label">${g.label}</span>`

    const ul = document.createElement('ul')
    ul.className = 'recent-items'
    ul.setAttribute('role', 'list')
    ul.hidden = !expanded
    for (const id of g.ids) appendRecentRow(ul, id, state)

    section.appendChild(headerBtn)
    section.appendChild(ul)
    wrap.appendChild(section)
  }
  listRoot.appendChild(wrap)
}

function appendRecentRow(ul: HTMLElement, id: string, state: ReturnType<AppStore['getState']>): void {
  const doc = state.documentsById.get(id)
  const label = doc?.title?.trim() || id

  const li = document.createElement('li')
  li.dataset.recentDocId = id

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
  ul.appendChild(li)
}

/** Wire SpeOps renderer shell (UPH-01 three-pane). */
export function bootRenderer(ctx: RendererBootContext): void {
  const { root, store, services, specOps } = ctx

  root.innerHTML = `
    <header class="app-toolbar" role="banner">
      <button type="button" id="btn-workspace-folder" class="toolbar-btn">Workspace folder…</button>
      <button type="button" id="btn-new-markdown" class="toolbar-btn">New markdown in workspace…</button>
      <button type="button" id="btn-seed-demos" class="toolbar-btn">Seed demo documents</button>
      <button type="button" id="btn-open-fixture" class="toolbar-btn">Open fixture sample</button>
      <span id="theme-controls-slot"></span>
      <span id="status-line" class="status-line"></span>
    </header>
    <div class="app-body">
      <aside data-testid="recents-pane" class="recents-pane" aria-label="Recent documents">
        <div class="recents-heading-row">
          <span class="recents-heading-title">Recents</span>
          <label class="recents-control"><span class="visually-hidden">Sort</span>
            <select id="recents-sort" class="recents-select" aria-label="Sort recents">
              <option value="lastOpened">Last opened</option>
              <option value="title">Title</option>
              <option value="path">Path</option>
            </select>
          </label>
          <label class="recents-control"><span class="visually-hidden">Group</span>
            <select id="recents-grouping" class="recents-select" aria-label="Group recents">
              <option value="none">No grouping</option>
              <option value="folder">By folder</option>
            </select>
          </label>
        </div>
        <div data-testid="recents-list" class="recents-list-root"></div>
      </aside>
      <div class="workspace">
        <div id="external-file-banner" class="external-file-banner" hidden role="status">
          <span class="external-file-banner-msg">This file changed on disk.</span>
          <button type="button" id="external-file-reload" class="toolbar-btn external-file-banner-btn">Reload</button>
          <button type="button" id="external-file-dismiss" class="toolbar-btn external-file-banner-btn">Dismiss</button>
        </div>
        <div class="workspace-columns">
          <div class="editor-pane">
            <textarea data-testid="editor" id="editor" class="editor-field" aria-label="Markdown editor" spellcheck="false"></textarea>
          </div>
          <div data-testid="preview" id="preview" class="preview-pane"></div>
        </div>
      </div>
    </div>
    <div id="recents-context-menu" class="recents-context-menu" hidden role="menu"></div>
  `

  const editor = root.querySelector<HTMLTextAreaElement>('#editor')!
  const previewEl = root.querySelector<HTMLElement>('#preview')!
  const recentsListRoot = root.querySelector<HTMLElement>('[data-testid="recents-list"]')!
  const workspaceEl = root.querySelector<HTMLElement>('.workspace')!
  const sortSelect = root.querySelector<HTMLSelectElement>('#recents-sort')!
  const groupSelect = root.querySelector<HTMLSelectElement>('#recents-grouping')!
  const contextMenu = root.querySelector<HTMLElement>('#recents-context-menu')!
  const externalBanner = root.querySelector<HTMLElement>('#external-file-banner')!
  const externalReload = root.querySelector<HTMLButtonElement>('#external-file-reload')!
  const externalDismiss = root.querySelector<HTMLButtonElement>('#external-file-dismiss')!
  const statusLine = root.querySelector<HTMLElement>('#status-line')!

  attachPreviewChrome(previewEl)

  let previewSeq = 0

  let pendingExternal: {
    readonly documentId: string
    readonly content: string
    readonly lastModified: string | null
  } | null = null

  let contextDocId: string | null = null

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

  function hideContextMenu(): void {
    contextMenu.hidden = true
    contextDocId = null
  }

  function openContextMenu(clientX: number, clientY: number, docId: string): void {
    const st = store.getState()
    const doc = st.documentsById.get(docId)
    if (!doc) return
    contextDocId = docId
    const hasPath = Boolean(doc.path?.trim())

    contextMenu.innerHTML = `
      <button type="button" role="menuitem" class="context-menu-item" data-action="reveal"${hasPath ? '' : ' disabled'}>Reveal in folder</button>
      <button type="button" role="menuitem" class="context-menu-item" data-action="remove">Remove from recents</button>
      <button type="button" role="menuitem" class="context-menu-item" data-action="copy-path"${hasPath ? '' : ' disabled'}>Copy path</button>
      <button type="button" role="menuitem" class="context-menu-item" data-action="copy-name">Copy filename</button>
    `
    contextMenu.hidden = false
    void contextMenu.offsetWidth
    const mw = contextMenu.offsetWidth
    const mh = contextMenu.offsetHeight
    const pad = 4
    contextMenu.style.left = `${Math.min(clientX, window.innerWidth - mw - pad)}px`
    contextMenu.style.top = `${Math.min(clientY, window.innerHeight - mh - pad)}px`
  }

  function syncSelectsFromState(): void {
    const st = store.getState()
    sortSelect.value = st.fileListSort
    groupSelect.value = st.fileListGrouping
  }

  let prevSelection: string | null | undefined

  async function syncWatchPath(): Promise<void> {
    const st = store.getState()
    const path =
      st.currentDocumentId !== null ? st.documentsById.get(st.currentDocumentId)?.path ?? null : null
    await specOps.setWatchedDocPath(path && path.trim() ? path : null)
  }

  store.subscribe(() => {
    const st = store.getState()
    if (editor.value !== st.editorContent) {
      editor.value = st.editorContent
    }
    syncSelectsFromState()
    renderRecents(recentsListRoot, store)

    if (prevSelection !== undefined && prevSelection !== st.currentDocumentId) {
      triggerWorkspaceMotion(workspaceEl)
      void syncWatchPath()
    }
    prevSelection = st.currentDocumentId

    root.dataset.currentDocId = st.currentDocumentId ?? ''
  })

  syncSelectsFromState()
  renderRecents(recentsListRoot, store)
  prevSelection = store.getState().currentDocumentId
  void syncWatchPath()

  editor.addEventListener('input', () => {
    store.dispatch({ type: 'EDITOR_CHANGE', content: editor.value })
    schedulePreview()
  })

  sortSelect.addEventListener('change', () => {
    const v = sortSelect.value as 'lastOpened' | 'title' | 'path'
    store.dispatch({ type: 'SET_FILE_LIST_SORT', sort: v })
  })

  groupSelect.addEventListener('change', () => {
    const v = groupSelect.value as 'none' | 'folder'
    store.dispatch({ type: 'SET_FILE_LIST_GROUPING', grouping: v })
  })

  recentsListRoot.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    const header = target?.closest<HTMLButtonElement>('button.recent-group-header')
    if (header?.dataset.folderKey) {
      store.dispatch({ type: 'TOGGLE_FOLDER_EXPANDED', folderKey: header.dataset.folderKey })
      return
    }
    const btn = target?.closest<HTMLButtonElement>('button.recent-item[data-recent-doc-id]')
    if (!btn?.dataset.recentDocId) return
    store.dispatch({ type: 'ACTIVATE_FROM_RECENT_LIST', documentId: btn.dataset.recentDocId })
    requestAnimationFrame(() => schedulePreview.flush())
  })

  recentsListRoot.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement | null
    const row = target?.closest<HTMLElement>('[data-recent-doc-id]')
    const id = row?.dataset.recentDocId
    if (!id) return
    event.preventDefault()
    openContextMenu(event.clientX, event.clientY, id)
  })

  contextMenu.addEventListener('click', (event) => {
    event.stopPropagation()
    const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-action]')
    if (!btn || btn.disabled || !contextDocId) return
    const st = store.getState()
    const doc = st.documentsById.get(contextDocId)
    hideContextMenu()
    if (!doc) return

    switch (btn.dataset.action) {
      case 'reveal':
        if (doc.path) void specOps.revealInFolder(doc.path)
        break
      case 'remove':
        store.dispatch({ type: 'REMOVE_FROM_RECENTS', documentId: doc.id })
        schedulePreview.flush()
        break
      case 'copy-path':
        if (doc.path) void navigator.clipboard.writeText(doc.path)
        break
      case 'copy-name': {
        const name = doc.path ? pathBasename(doc.path) : doc.title || doc.id
        void navigator.clipboard.writeText(name)
        break
      }
      default:
        break
    }
  })

  document.body.addEventListener(
    'click',
    () => {
      hideContextMenu()
    },
    true
  )

  document.body.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu()
  })

  root.querySelector('#btn-workspace-folder')!.addEventListener('click', () => {
    void (async () => {
      const picked = await specOps.pickWorkspaceFolder()
      store.dispatch({ type: 'SET_WORKSPACE_FOLDER', path: picked })
    })()
  })

  root.querySelector('#btn-new-markdown')!.addEventListener('click', () => {
    void (async () => {
      const folder = store.getState().workspaceFolderPath
      if (!folder) {
        window.alert('Choose a workspace folder first.')
        return
      }
      const raw = window.prompt('New Markdown file name', 'notes.md')
      if (raw === null) return
      const created = await specOps.createMarkdownInWorkspace({ folderPath: folder, baseName: raw })
      if (!created.ok) {
        window.alert(`Could not create file (${created.reason}).`)
        return
      }
      const read = await specOps.readTextFile(created.absolutePath)
      if (!read.ok) {
        window.alert(`Created file but could not read it (${read.reason}).`)
        return
      }
      const id = stableDocIdForPath(created.absolutePath)
      store.dispatch({
        type: 'OPEN_EXPLICIT',
        document: {
          id,
          title: pathBasename(created.absolutePath).replace(/\.md$/i, '') || id,
          content: read.content,
          path: created.absolutePath,
          lastModified: read.mtimeIso
        }
      })
      schedulePreview.flush()
    })()
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

  externalReload.addEventListener('click', () => {
    if (!pendingExternal) return
    store.dispatch({
      type: 'SYNC_DOCUMENT_FROM_DISK',
      documentId: pendingExternal.documentId,
      content: pendingExternal.content,
      lastModified: pendingExternal.lastModified
    })
    pendingExternal = null
    externalBanner.hidden = true
    schedulePreview.flush()
  })

  externalDismiss.addEventListener('click', () => {
    pendingExternal = null
    externalBanner.hidden = true
  })

  specOps.onExternalFileChanged((payload) => {
    const st = store.getState()
    const docId = documentIdForAbsolutePath(st, payload.path)
    if (!docId) return
    const isCurrent = st.currentDocumentId === docId
    if (isCurrent && isEditorDirty(st)) {
      pendingExternal = {
        documentId: docId,
        content: payload.content,
        lastModified: payload.mtimeIso
      }
      externalBanner.hidden = false
      return
    }
    store.dispatch({
      type: 'SYNC_DOCUMENT_FROM_DISK',
      documentId: docId,
      content: payload.content,
      lastModified: payload.mtimeIso
    })
    schedulePreview.flush()
  })

  statusLine.textContent = `${specOps.ping()} • v${specOps.getAppVersion()} • ${specOps.getPlatform()}`

  void runPreview()
}

/** Resolve toolbar slot for theme control (Task 10). */
export function getThemeControlsSlot(root: HTMLElement): HTMLElement | null {
  return root.querySelector('#theme-controls-slot')
}
