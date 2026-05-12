import type { SpecOpsPreloadApi } from '../../preload/specOpsApi'
import type { AppServices } from '../../app/services'
import type { AppStore } from '../../core/state/store'
import type { DocumentInput } from '../../core/state/types'
import { debounce } from '../../core/util/debounce'
import {
  buildSearchPattern,
  findMatchCovering,
  findNext,
  findPrevious,
  replaceAllLiteral,
  type FindReplaceFlags
} from '../../core/editor/findReplace'
import { createEditorHistory } from '../editor/editorHistory'
import {
  documentIdForAbsolutePath,
  groupsForPresentation,
  isEditorDirty,
  isFolderExpanded
} from '../../core/state/fileListPresentation'
import { pathBasename, replaceBasename, stableDocIdForPath } from '../../core/util/paths'
import {
  serializePreferencesFromState,
  serializeSessionFromState
} from '../../core/state/sessionCodec'
import { attachPreviewChrome, mountPreview, previewErrorSnippet } from '../previewHost'
import { buildEditorHighlightHtml } from '../editor/editorHighlight'

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
      <button type="button" id="btn-open-markdown" class="toolbar-btn">Open…</button>
      <button type="button" id="btn-save" class="toolbar-btn">Save</button>
      <button type="button" id="btn-save-as" class="toolbar-btn">Save As…</button>
      <button type="button" id="btn-new-untitled" class="toolbar-btn">New untitled</button>
      <span id="dirty-indicator" class="dirty-indicator" hidden aria-live="polite">Modified</span>
      <label class="toolbar-autosave"><input type="checkbox" id="editor-autosave" /> Autosave</label>
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
      <div class="recents-resizer" role="separator" aria-orientation="vertical" aria-label="Resize recents panel" tabindex="-1"></div>
      <div class="workspace">
        <div id="external-file-banner" class="external-file-banner" hidden role="status">
          <span class="external-file-banner-msg">This file changed on disk.</span>
          <button type="button" id="external-file-reload" class="toolbar-btn external-file-banner-btn">Reload</button>
          <button type="button" id="external-file-dismiss" class="toolbar-btn external-file-banner-btn">Dismiss</button>
        </div>
          <div class="workspace-columns">
          <div class="editor-pane">
            <div id="find-panel" class="find-panel" hidden>
              <div class="find-panel-header">
                <span class="find-panel-heading">Find &amp; replace</span>
                <button type="button" id="find-close" class="find-close-btn" aria-label="Close find panel">×</button>
              </div>
              <div class="find-panel-grid">
                <label class="find-field-label"><span class="find-field-caption">Find</span>
                  <input type="text" id="find-input" class="find-field-input" autocomplete="off" spellcheck="false" />
                </label>
                <label class="find-field-label"><span class="find-field-caption">Replace</span>
                  <input type="text" id="replace-input" class="find-field-input" autocomplete="off" spellcheck="false" />
                </label>
              </div>
              <div class="find-panel-toolbar">
                <label class="find-option"><input type="checkbox" id="find-case" /> Case sensitive</label>
                <label class="find-option"><input type="checkbox" id="find-regex" /> Regex</label>
                <span id="find-error" class="find-error" hidden></span>
                <span class="find-toolbar-spacer"></span>
                <button type="button" id="find-prev" class="toolbar-btn find-action-btn">Previous</button>
                <button type="button" id="find-next" class="toolbar-btn find-action-btn">Next</button>
                <button type="button" id="find-replace" class="toolbar-btn find-action-btn">Replace</button>
                <button type="button" id="find-replace-all" class="toolbar-btn find-action-btn">Replace all</button>
              </div>
            </div>
            <div class="editor-main">
              <div id="line-gutter" class="line-gutter" aria-hidden="true" hidden></div>
              <div class="editor-stack">
                <pre class="editor-highlight" aria-hidden="true"><code id="editor-highlight-content" class="editor-highlight-content"></code></pre>
                <textarea data-testid="editor" id="editor" class="editor-field editor-field--layered" aria-label="Markdown editor" spellcheck="false"></textarea>
              </div>
            </div>
          </div>
          <div data-testid="preview" id="preview" class="preview-pane"></div>
        </div>
      </div>
    </div>
    <footer class="app-status-footer" aria-label="Status">
      <span class="app-status-encoding">UTF-8</span>
    </footer>
    <div id="recents-context-menu" class="recents-context-menu" hidden role="menu"></div>
  `

  const editor = root.querySelector<HTMLTextAreaElement>('#editor')!
  const findPanel = root.querySelector<HTMLElement>('#find-panel')!
  const findInput = root.querySelector<HTMLInputElement>('#find-input')!
  const replaceInput = root.querySelector<HTMLInputElement>('#replace-input')!
  const findCase = root.querySelector<HTMLInputElement>('#find-case')!
  const findRegex = root.querySelector<HTMLInputElement>('#find-regex')!
  const findError = root.querySelector<HTMLElement>('#find-error')!
  const findPrevBtn = root.querySelector<HTMLButtonElement>('#find-prev')!
  const findNextBtn = root.querySelector<HTMLButtonElement>('#find-next')!
  const findReplaceBtn = root.querySelector<HTMLButtonElement>('#find-replace')!
  const findReplaceAllBtn = root.querySelector<HTMLButtonElement>('#find-replace-all')!
  const findCloseBtn = root.querySelector<HTMLButtonElement>('#find-close')!
  const lineGutter = root.querySelector<HTMLElement>('#line-gutter')!
  const editorStack = root.querySelector<HTMLElement>('.editor-stack')!
  const editorHighlightContent = root.querySelector<HTMLElement>('#editor-highlight-content')!
  const previewEl = root.querySelector<HTMLElement>('#preview')!
  const recentsListRoot = root.querySelector<HTMLElement>('[data-testid="recents-list"]')!
  const workspaceEl = root.querySelector<HTMLElement>('.workspace')!
  const sortSelect = root.querySelector<HTMLSelectElement>('#recents-sort')!
  const groupSelect = root.querySelector<HTMLSelectElement>('#recents-grouping')!
  const contextMenu = root.querySelector<HTMLElement>('#recents-context-menu')!
  const externalBanner = root.querySelector<HTMLElement>('#external-file-banner')!
  const statusLine = root.querySelector<HTMLElement>('#status-line')!
  const dirtyIndicator = root.querySelector<HTMLElement>('#dirty-indicator')!
  const editorAutosave = root.querySelector<HTMLInputElement>('#editor-autosave')!
  const recentsResizer = root.querySelector<HTMLElement>('.recents-resizer')!

  attachPreviewChrome(previewEl)

  let previewSeq = 0

  let pendingExternal: {
    readonly documentId: string
    readonly content: string
    readonly lastModified: string | null
  } | null = null

  function setExternalFileBannerVisible(visible: boolean): void {
    externalBanner.hidden = !visible
    if (visible) {
      externalBanner.style.removeProperty('display')
    } else {
      externalBanner.style.display = 'none'
    }
  }

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

  /** Undo/redo owns Ctrl/Cmd+Z when the stack applies; avoid mixing with native textarea undo. */
  const HISTORY_DEPTH = 75
  const editorHistory = createEditorHistory(HISTORY_DEPTH)
  let suppressHistory = false
  let prevHistoryDocId: string | null = store.getState().currentDocumentId

  function snapshotEditor(): { value: string; selStart: number; selEnd: number } {
    return {
      value: editor.value,
      selStart: editor.selectionStart,
      selEnd: editor.selectionEnd
    }
  }

  function pushHistoryIfChanged(): void {
    if (suppressHistory) return
    const snap = snapshotEditor()
    const top = editorHistory.peekUndo()
    if (
      top &&
      top.value === snap.value &&
      top.selStart === snap.selStart &&
      top.selEnd === snap.selEnd
    ) {
      return
    }
    editorHistory.push(snap)
  }

  const scheduleHistoryPush = debounce(() => pushHistoryIfChanged(), 250)

  let prevPrefsJson = ''
  let prevSessionJson = ''
  let prevDirty = false

  const schedulePrefsPersist = debounce(() => {
    void specOps.writePreferences(serializePreferencesFromState(store.getState()))
  }, 400)

  const scheduleSessionPersist = debounce(() => {
    void specOps.writeSession(serializeSessionFromState(store.getState()))
  }, 500)

  function refreshLineGutter(): void {
    if (!lineGutter.hidden) {
      const lines = editor.value.split('\n')
      lineGutter.innerHTML = lines
        .map((_ln, i) => `<div class="line-gutter-line">${String(i + 1)}</div>`)
        .join('')
      lineGutter.scrollTop = editor.scrollTop
    }
    syncEditorHighlightScroll()
  }

  function syncEditorHighlightScroll(): void {
    editorHighlightContent.style.transform = `translate3d(${-editor.scrollLeft}px, ${-editor.scrollTop}px, 0)`
  }

  function refreshEditorHighlight(): void {
    editorHighlightContent.innerHTML = buildEditorHighlightHtml(editor.value)
    syncEditorHighlightScroll()
  }

  function scrollCaretIntoView(): void {
    const pos = Math.min(editor.selectionStart, editor.selectionEnd)
    const lineNo = editor.value.slice(0, pos).split('\n').length - 1
    const cs = getComputedStyle(editor)
    let lineHeight = parseFloat(cs.lineHeight)
    if (!Number.isFinite(lineHeight)) {
      const fs = parseFloat(cs.fontSize)
      lineHeight = Number.isFinite(fs) ? fs * 1.35 : 18
    }
    const padTop = parseFloat(cs.paddingTop) || 0
    const target = Math.max(0, lineNo * lineHeight + padTop - editor.clientHeight / 2 + lineHeight / 2)
    editor.scrollTop = Math.min(target, Math.max(0, editor.scrollHeight - editor.clientHeight))
    refreshLineGutter()
  }

  function readFindFlags(): FindReplaceFlags {
    return { caseSensitive: findCase.checked, regex: findRegex.checked }
  }

  function refreshFindPatternError(): void {
    const flags = readFindFlags()
    const raw = findInput.value
    if (!flags.regex || !raw.trim()) {
      findError.hidden = true
      findError.textContent = ''
      return
    }
    const built = buildSearchPattern(raw, flags)
    if (built.ok) {
      findError.hidden = true
      findError.textContent = ''
    } else {
      findError.textContent = built.error
      findError.hidden = false
    }
  }

  function setFindPanel(open: boolean): void {
    findPanel.hidden = !open
    if (open) {
      findPanel.style.removeProperty('display')
    } else {
      findPanel.style.display = 'none'
    }
    refreshFindPatternError()
  }

  function toggleFindPanelShortcut(): void {
    if (!findPanel.hidden) {
      setFindPanel(false)
      editor.focus()
      return
    }
    setFindPanel(true)
    findInput.focus()
    findInput.select()
  }

  function openReplacePanelShortcut(): void {
    setFindPanel(true)
    replaceInput.focus()
    replaceInput.select()
  }

  function applyEditorChange(nextValue: string, selStart: number, selEnd: number): void {
    suppressHistory = true
    editor.value = nextValue
    editor.selectionStart = selStart
    editor.selectionEnd = selEnd
    store.dispatch({ type: 'EDITOR_CHANGE', content: nextValue })
    suppressHistory = false
    refreshLineGutter()
    refreshEditorHighlight()
    schedulePreview()
  }

  function applyUndoRedoSnapshot(snap: { value: string; selStart: number; selEnd: number }): void {
    suppressHistory = true
    editor.value = snap.value
    editor.selectionStart = snap.selStart
    editor.selectionEnd = snap.selEnd
    store.dispatch({ type: 'EDITOR_CHANGE', content: snap.value })
    suppressHistory = false
    refreshLineGutter()
    refreshEditorHighlight()
    schedulePreview.flush()
    scheduleHistoryPush.cancel()
  }

  function applyFindNext(): void {
    refreshFindPatternError()
    const flags = readFindFlags()
    const needle = findInput.value
    const built = buildSearchPattern(needle, flags)
    if (!built.ok) return
    const m = findNext(editor.value, editor.selectionStart, editor.selectionEnd, needle, flags)
    if (!m) return
    editor.focus()
    editor.selectionStart = m.start
    editor.selectionEnd = m.end
    scrollCaretIntoView()
  }

  function applyFindPrevious(): void {
    refreshFindPatternError()
    const flags = readFindFlags()
    const needle = findInput.value
    const built = buildSearchPattern(needle, flags)
    if (!built.ok) return
    const m = findPrevious(editor.value, editor.selectionStart, editor.selectionEnd, needle, flags)
    if (!m) return
    editor.focus()
    editor.selectionStart = m.start
    editor.selectionEnd = m.end
    scrollCaretIntoView()
  }

  function applyReplace(): void {
    refreshFindPatternError()
    const flags = readFindFlags()
    const needle = findInput.value
    const repl = replaceInput.value
    const built = buildSearchPattern(needle, flags)
    if (!built.ok) return
    const cov = findMatchCovering(editor.value, editor.selectionStart, editor.selectionEnd, needle, flags)
    if (cov) {
      editorHistory.push(snapshotEditor())
      const next = editor.value.slice(0, cov.start) + repl + editor.value.slice(cov.end)
      const caret = cov.start + repl.length
      applyEditorChange(next, caret, caret)
      scheduleHistoryPush.cancel()
      return
    }
    applyFindNext()
  }

  function applyReplaceAll(): void {
    refreshFindPatternError()
    const flags = readFindFlags()
    const needle = findInput.value
    const repl = replaceInput.value
    const built = buildSearchPattern(needle, flags)
    if (!built.ok) return
    editorHistory.push(snapshotEditor())
    const next = replaceAllLiteral(editor.value, needle, repl, flags)
    const pos = Math.min(editor.selectionStart, next.length)
    applyEditorChange(next, pos, pos)
    scheduleHistoryPush.cancel()
  }

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
      <button type="button" role="menuitem" class="context-menu-item" data-action="rename-file"${hasPath ? '' : ' disabled'}>Rename file…</button>
      <button type="button" role="menuitem" class="context-menu-item" data-action="delete-file"${hasPath ? '' : ' disabled'}>Delete file…</button>
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

  function openLoadedDocument(absPath: string, content: string, lastModified: string | null): void {
    const id = stableDocIdForPath(absPath)
    store.dispatch({
      type: 'OPEN_EXPLICIT',
      document: {
        id,
        title: pathBasename(absPath).replace(/\.md$/i, '') || id,
        content,
        path: absPath,
        lastModified
      }
    })
    schedulePreview.flush()
  }

  async function openMarkdownFromAbsolutePath(absPath: string): Promise<void> {
    const read = await specOps.readTextFile(absPath)
    if (!read.ok) {
      window.alert(`Could not open file (${read.reason}).`)
      return
    }
    openLoadedDocument(absPath, read.content, read.mtimeIso)
  }

  async function saveCurrentBuffer(): Promise<boolean> {
    const st = store.getState()
    const id = st.currentDocumentId
    if (!id) return false
    const doc = st.documentsById.get(id)
    if (!doc) return false
    const body = st.editorContent
    const targetPath = doc.path?.trim()
    if (targetPath) {
      const wr = await specOps.writeTextFile({ absolutePath: targetPath, content: body })
      if (!wr.ok) {
        window.alert(`Save failed (${wr.reason}).`)
        return false
      }
      store.dispatch({
        type: 'SYNC_DOCUMENT_FROM_DISK',
        documentId: id,
        content: body,
        lastModified: wr.mtimeIso
      })
      schedulePreview.flush()
      void specOps.clearDraft(id)
      return true
    }
    const pick = await specOps.pickSaveMarkdownFile({
      defaultPath: doc.title ? `${doc.title}.md` : undefined
    })
    if (pick.canceled) return false
    const wr = await specOps.writeTextFile({ absolutePath: pick.filePath, content: body })
    if (!wr.ok) {
      window.alert(`Save failed (${wr.reason}).`)
      return false
    }
    store.dispatch({
      type: 'REPARENT_DOCUMENT',
      oldDocumentId: id,
      newAbsolutePath: pick.filePath,
      content: body,
      lastModified: wr.mtimeIso
    })
    void syncWatchPath()
    schedulePreview.flush()
    void specOps.clearDraft(id)
    return true
  }

  async function saveCurrentBufferAs(): Promise<boolean> {
    const st = store.getState()
    const id = st.currentDocumentId
    if (!id) return false
    const doc = st.documentsById.get(id)
    if (!doc) return false
    const body = st.editorContent
    const pick = await specOps.pickSaveMarkdownFile({
      defaultPath: doc.path ?? (doc.title ? `${doc.title}.md` : undefined)
    })
    if (pick.canceled) return false
    const wr = await specOps.writeTextFile({ absolutePath: pick.filePath, content: body })
    if (!wr.ok) {
      window.alert(`Save failed (${wr.reason}).`)
      return false
    }
    const newId = stableDocIdForPath(pick.filePath)
    if (newId === id) {
      store.dispatch({
        type: 'SYNC_DOCUMENT_FROM_DISK',
        documentId: id,
        content: body,
        lastModified: wr.mtimeIso
      })
      void specOps.clearDraft(id)
    } else {
      store.dispatch({
        type: 'REPARENT_DOCUMENT',
        oldDocumentId: id,
        newAbsolutePath: pick.filePath,
        content: body,
        lastModified: wr.mtimeIso
      })
      void specOps.clearDraft(id)
    }
    void syncWatchPath()
    schedulePreview.flush()
    return true
  }

  const scheduleDraftWrite = debounce(() => {
    const st = store.getState()
    const id = st.currentDocumentId
    if (!id || !isEditorDirty(st)) return
    void specOps.writeDraft({ documentId: id, content: st.editorContent })
  }, 750)

  const scheduleAutosave = debounce(() => {
    void saveCurrentBuffer()
  }, 1000)

  async function runAfterDirtyPrompt(action: () => void | Promise<void>): Promise<void> {
    const st = store.getState()
    if (!isEditorDirty(st)) {
      await Promise.resolve(action())
      return
    }
    const choice = await specOps.promptDirtyNavigation()
    if (choice === 'cancel') return
    if (choice === 'discard') {
      const sid = st.currentDocumentId
      if (sid) {
        void specOps.clearDraft(sid)
        const d = st.documentsById.get(sid)
        if (d) store.dispatch({ type: 'EDITOR_CHANGE', content: d.content })
      }
      await Promise.resolve(action())
      return
    }
    const saved = await saveCurrentBuffer()
    if (!saved) return
    await Promise.resolve(action())
  }

  function collectDroppedMarkdownPaths(dt: DataTransfer | null): string[] {
    const out: string[] = []
    const files = dt?.files
    if (!files?.length) return out
    for (let i = 0; i < files.length; i++) {
      const raw = (files[i] as File & { path?: string }).path
      if (typeof raw === 'string' && raw.toLowerCase().endsWith('.md')) out.push(raw)
    }
    return out
  }

  function miscPickWorkspaceFolder(): void {
    void (async () => {
      const picked = await specOps.pickWorkspaceFolder()
      store.dispatch({ type: 'SET_WORKSPACE_FOLDER', path: picked })
    })()
  }

  function miscNewMarkdownInWorkspace(): void {
    void runAfterDirtyPrompt(async () => {
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
    })
  }

  function miscSeedDemos(): void {
    void runAfterDirtyPrompt(() => {
      const t0 = new Date().toISOString()
      store.dispatch({ type: 'OPEN_EXPLICIT', document: SAMPLE_DOC_B }, t0)
      store.dispatch({ type: 'OPEN_EXPLICIT', document: SAMPLE_DOC_A }, t0)
      schedulePreview.flush()
    })
  }

  function miscOpenFixture(): void {
    void runAfterDirtyPrompt(async () => {
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
    })
  }

  function syncShellFromStore(): void {
    const st = store.getState()
    document.documentElement.style.setProperty('--recents-width', `${st.recentsPaneWidthPx}px`)

    if (st.currentDocumentId !== prevHistoryDocId) {
      editorHistory.clear()
      scheduleHistoryPush.cancel()
      prevHistoryDocId = st.currentDocumentId
    }
    if (editor.value !== st.editorContent) {
      suppressHistory = true
      editor.value = st.editorContent
      suppressHistory = false
      scheduleHistoryPush.cancel()
      refreshLineGutter()
    }

    editor.classList.toggle('editor-field--wrap', st.editorSoftWrap)
    editorStack.classList.toggle('editor-stack--wrap', st.editorSoftWrap)
    lineGutter.hidden = !st.editorLineNumbers
    if (st.editorLineNumbers) refreshLineGutter()
    editorAutosave.checked = st.autosaveEnabled

    dirtyIndicator.hidden = !isEditorDirty(st)

    const pj = JSON.stringify(serializePreferencesFromState(st))
    if (pj !== prevPrefsJson) {
      prevPrefsJson = pj
      schedulePrefsPersist()
    }
    const sj = JSON.stringify(serializeSessionFromState(st))
    if (sj !== prevSessionJson) {
      prevSessionJson = sj
      scheduleSessionPersist()
    }

    const dirty = isEditorDirty(st)
    if (prevDirty && !dirty && st.currentDocumentId) {
      void specOps.clearDraft(st.currentDocumentId)
    }
    prevDirty = dirty
    if (dirty && st.currentDocumentId) {
      scheduleDraftWrite()
    }

    const doc = st.currentDocumentId ? st.documentsById.get(st.currentDocumentId) : undefined
    if (st.autosaveEnabled && doc?.path?.trim() && dirty) {
      scheduleAutosave()
    }

    syncSelectsFromState()
    renderRecents(recentsListRoot, store)

    if (prevSelection !== undefined && prevSelection !== st.currentDocumentId) {
      triggerWorkspaceMotion(workspaceEl)
      void syncWatchPath()
    }
    prevSelection = st.currentDocumentId

    root.dataset.currentDocId = st.currentDocumentId ?? ''

    refreshEditorHighlight()
  }

  store.subscribe(syncShellFromStore)
  syncShellFromStore()
  void syncWatchPath()

  let resizerDragStartX = 0
  let resizerStartWidthPx = 0
  recentsResizer.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    resizerDragStartX = e.clientX
    resizerStartWidthPx = store.getState().recentsPaneWidthPx
    recentsResizer.setPointerCapture(e.pointerId)
  })
  recentsResizer.addEventListener('pointermove', (e) => {
    if (!recentsResizer.hasPointerCapture(e.pointerId)) return
    const delta = e.clientX - resizerDragStartX
    const clamped = Math.min(560, Math.max(180, resizerStartWidthPx + delta))
    document.documentElement.style.setProperty('--recents-width', `${clamped}px`)
  })
  recentsResizer.addEventListener('pointerup', (e) => {
    if (!recentsResizer.hasPointerCapture(e.pointerId)) return
    recentsResizer.releasePointerCapture(e.pointerId)
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--recents-width').trim()
    const n = parseFloat(raw)
    if (Number.isFinite(n)) {
      store.dispatch({ type: 'SET_RECENTS_PANE_WIDTH', widthPx: n })
    }
  })
  recentsResizer.addEventListener('pointercancel', (e) => {
    if (recentsResizer.hasPointerCapture(e.pointerId)) {
      recentsResizer.releasePointerCapture(e.pointerId)
    }
    const w = store.getState().recentsPaneWidthPx
    document.documentElement.style.setProperty('--recents-width', `${w}px`)
  })

  editor.addEventListener('input', () => {
    store.dispatch({ type: 'EDITOR_CHANGE', content: editor.value })
    refreshEditorHighlight()
    schedulePreview()
    scheduleHistoryPush()
    scheduleDraftWrite()
  })

  editor.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.shiftKey) return
    e.preventDefault()
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const v = editor.value
    const next = v.slice(0, start) + '\t' + v.slice(end)
    suppressHistory = true
    editor.value = next
    editor.selectionStart = editor.selectionEnd = start + 1
    suppressHistory = false
    store.dispatch({ type: 'EDITOR_CHANGE', content: next })
    refreshEditorHighlight()
    schedulePreview()
    scheduleHistoryPush()
    scheduleDraftWrite()
  })

  editor.addEventListener('scroll', () => {
    lineGutter.scrollTop = editor.scrollTop
    syncEditorHighlightScroll()
  })

  findInput.addEventListener('input', () => refreshFindPatternError())
  findRegex.addEventListener('change', () => refreshFindPatternError())
  findCase.addEventListener('change', () => refreshFindPatternError())

  editorAutosave.addEventListener('change', () => {
    store.dispatch({ type: 'SET_AUTOSAVE_ENABLED', enabled: editorAutosave.checked })
  })

  findPrevBtn.addEventListener('click', () => applyFindPrevious())
  findNextBtn.addEventListener('click', () => applyFindNext())
  findReplaceBtn.addEventListener('click', () => applyReplace())
  findReplaceAllBtn.addEventListener('click', () => applyReplaceAll())
  findCloseBtn.addEventListener(
    'click',
    (e) => {
      e.preventDefault()
      e.stopPropagation()
      setFindPanel(false)
      editor.focus()
    },
    true
  )

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
    const docId = btn?.dataset.recentDocId
    if (!docId) return
    void runAfterDirtyPrompt(() => {
      store.dispatch({ type: 'ACTIVATE_FROM_RECENT_LIST', documentId: docId })
      requestAnimationFrame(() => schedulePreview.flush())
    })
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
      case 'rename-file': {
        if (!doc.path) break
        const currentBase = pathBasename(doc.path)
        const nv = window.prompt('New file name', currentBase)
        if (nv === null) break
        let nextName = nv.trim().replace(/[/\\]/g, '')
        if (!nextName) break
        if (!nextName.toLowerCase().endsWith('.md')) nextName += '.md'
        const newPath = replaceBasename(doc.path, nextName)
        void (async () => {
          const latest = store.getState()
          const d = latest.documentsById.get(doc.id)
          if (!d?.path) return
          const rn = await specOps.renamePathOnDisk({ fromPath: d.path, toPath: newPath })
          if (!rn.ok) {
            window.alert(`Rename failed (${rn.reason}).`)
            return
          }
          store.dispatch({
            type: 'REPARENT_DOCUMENT',
            oldDocumentId: d.id,
            newAbsolutePath: newPath,
            content: latest.editorContent,
            lastModified: rn.mtimeIso
          })
          void syncWatchPath()
          schedulePreview.flush()
        })()
        break
      }
      case 'delete-file': {
        const pathToDelete = doc.path
        if (!pathToDelete) break
        const base = pathBasename(pathToDelete)
        void (async () => {
          const okDel = await specOps.confirmDeleteFile(base)
          if (!okDel) return
          const ul = await specOps.unlinkFilePath(pathToDelete)
          if (!ul.ok) {
            window.alert(`Delete failed (${ul.reason}).`)
            return
          }
          store.dispatch({ type: 'DROP_DOCUMENT', documentId: doc.id })
          void syncWatchPath()
          schedulePreview.flush()
        })()
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
    if (e.key !== 'Escape') return
    if (!findPanel.hidden) {
      setFindPanel(false)
      editor.focus()
      e.preventDefault()
      return
    }
    hideContextMenu()
  })

  root.querySelector('#btn-open-markdown')!.addEventListener('click', () => {
    void runAfterDirtyPrompt(async () => {
      const pick = await specOps.pickOpenMarkdownFile()
      if (pick.canceled) return
      await openMarkdownFromAbsolutePath(pick.filePath)
    })
  })

  root.querySelector('#btn-save')!.addEventListener('click', () => {
    void saveCurrentBuffer()
  })

  root.querySelector('#btn-save-as')!.addEventListener('click', () => {
    void saveCurrentBufferAs()
  })

  root.querySelector('#btn-new-untitled')!.addEventListener('click', () => {
    void runAfterDirtyPrompt(() => {
      const id = `untitled:${crypto.randomUUID()}`
      store.dispatch({
        type: 'OPEN_EXPLICIT',
        document: {
          id,
          title: 'Untitled',
          content: '',
          path: null,
          lastModified: null
        }
      })
      schedulePreview.flush()
    })
  })

  let dragDepth = 0
  root.addEventListener('dragover', (e) => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  })
  root.addEventListener('drop', (e) => {
    dragDepth = 0
    delete workspaceEl.dataset.dragActive
    e.preventDefault()
    const paths = collectDroppedMarkdownPaths(e.dataTransfer)
    const first = paths[0]
    if (!first) return
    void runAfterDirtyPrompt(() => openMarkdownFromAbsolutePath(first))
  })

  root.addEventListener('dragenter', (e) => {
    const types = e.dataTransfer?.types ? [...e.dataTransfer.types] : []
    if (types.includes('Files')) {
      dragDepth++
      workspaceEl.dataset.dragActive = 'true'
    }
  })
  root.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) delete workspaceEl.dataset.dragActive
  })

  specOps.onMenuCommand((cmd) => {
    switch (cmd) {
      case 'open-file':
        root.querySelector<HTMLButtonElement>('#btn-open-markdown')?.click()
        break
      case 'misc-workspace-folder':
        miscPickWorkspaceFolder()
        break
      case 'misc-new-markdown':
        miscNewMarkdownInWorkspace()
        break
      case 'misc-seed-demos':
        miscSeedDemos()
        break
      case 'misc-open-fixture':
        miscOpenFixture()
        break
      case 'new-untitled':
        root.querySelector<HTMLButtonElement>('#btn-new-untitled')?.click()
        break
      case 'save':
        void saveCurrentBuffer()
        break
      case 'save-as':
        void saveCurrentBufferAs()
        break
      case 'find':
        toggleFindPanelShortcut()
        break
      case 'find-replace':
        openReplacePanelShortcut()
        break
      default:
        break
    }
  })

  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey
    const ek = e.key.toLowerCase()

    if (mod && ek === 's') {
      e.preventDefault()
      void saveCurrentBuffer()
      return
    }

    if (mod && ek === 'f') {
      e.preventDefault()
      toggleFindPanelShortcut()
      return
    }

    if (mod && ek === 'h') {
      e.preventDefault()
      openReplacePanelShortcut()
      return
    }

    if (document.activeElement === editor) {
      if (mod && ek === 'z' && !e.shiftKey) {
        const prev = editorHistory.undo(snapshotEditor())
        if (prev) {
          e.preventDefault()
          applyUndoRedoSnapshot(prev)
        }
        return
      }
      if ((mod && ek === 'z' && e.shiftKey) || (mod && ek === 'y' && !e.shiftKey)) {
        const next = editorHistory.redo(snapshotEditor())
        if (next) {
          e.preventDefault()
          applyUndoRedoSnapshot(next)
        }
      }
    }
  })

  externalBanner.addEventListener(
    'click',
    (e) => {
      const btn = (e.target as HTMLElement | null)?.closest('button')
      if (!btn || !externalBanner.contains(btn)) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      const id = btn.id
      if (id === 'external-file-reload') {
        if (pendingExternal) {
          store.dispatch({
            type: 'SYNC_DOCUMENT_FROM_DISK',
            documentId: pendingExternal.documentId,
            content: pendingExternal.content,
            lastModified: pendingExternal.lastModified
          })
        }
        pendingExternal = null
        setExternalFileBannerVisible(false)
        schedulePreview.flush()
        return
      }
      if (id === 'external-file-dismiss') {
        pendingExternal = null
        setExternalFileBannerVisible(false)
      }
    },
    true
  )

  specOps.onExternalFileChanged((payload) => {
    const st = store.getState()
    const docId = documentIdForAbsolutePath(st, payload.path)
    if (!docId) return
    const isCurrent = st.currentDocumentId === docId
    if (isCurrent && isEditorDirty(st)) {
      if (payload.content === st.editorContent) {
        return
      }
      pendingExternal = {
        documentId: docId,
        content: payload.content,
        lastModified: payload.mtimeIso
      }
      setExternalFileBannerVisible(true)
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
