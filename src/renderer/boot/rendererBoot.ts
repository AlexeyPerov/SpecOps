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
  isEditorDirty
} from '../../core/state/fileListPresentation'
import {
  isMarkdownCapableDocumentPath,
  selectActiveProject,
  selectCurrentDocumentPath
} from '../../core/state/selectors'
import { pathBasename, replaceBasename, stableDocIdForPath } from '../../core/util/paths'
import { resolveContainedScanRoot } from '../../core/util/markdownScanFolders'
import {
  serializePreferencesFromState,
  serializeSessionFromState
} from '../../core/state/sessionCodec'
import { executeMenuCommand } from '../features/menu/menuCommands'
import { wireProjectSwitcher } from '../features/projects/projectSwitcher'
import { renderRecents, triggerWorkspaceMotion } from '../features/recents/recentsView'
import { attachPreviewChrome, mountPreview, previewErrorSnippet } from '../previewHost'
import { buildEditorHighlightHtml } from '../editor/editorHighlight'
import { getScrollFraction, setScrollFraction } from '../editor/scrollSync'

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

/** Wire SpeOps renderer shell (UPH-01 three-pane). */
export function bootRenderer(ctx: RendererBootContext): void {
  const { root, store, services, specOps } = ctx
  const getPathForDroppedFile = (file: File): string | null => {
    if (typeof specOps.getPathForFile === 'function') return specOps.getPathForFile(file)
    const legacyPath = (file as File & { path?: string }).path
    return typeof legacyPath === 'string' && legacyPath.trim() ? legacyPath : null
  }
  const listMarkdownFilesRecursive = async (folderPath: string): Promise<string[]> => {
    if (typeof specOps.listMarkdownFilesRecursive === 'function') {
      return specOps.listMarkdownFilesRecursive(folderPath)
    }
    return []
  }

  root.innerHTML = `
    <header class="app-toolbar" role="banner">
      <span id="dirty-indicator" class="dirty-indicator" hidden aria-live="polite">Modified</span>
      <span id="current-file-label" class="current-file-label" title="No file selected">No file selected</span>
      <div class="view-mode-switch" role="group" aria-label="Editor view mode">
        <button type="button" class="toolbar-btn mode-btn" data-view-mode="split" aria-pressed="true">Split</button>
        <button type="button" class="toolbar-btn mode-btn" data-view-mode="edit" aria-pressed="false">Edit</button>
        <button type="button" class="toolbar-btn mode-btn" data-view-mode="preview" aria-pressed="false">Preview</button>
      </div>
    </header>
    <div class="app-body">
      <aside class="projects-rail" aria-label="Projects">
        <button type="button" id="btn-add-project" class="project-rail-btn project-rail-add" title="Add project…">+</button>
        <div class="projects-rail-list" data-testid="projects-rail-list"></div>
      </aside>
      <aside data-testid="recents-pane" class="recents-pane" aria-label="Recent documents">
        <div class="recents-heading-row">
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
                <textarea data-testid="editor" id="editor" class="editor-field editor-field--layered" aria-label="Text editor" spellcheck="false"></textarea>
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
  const workspaceColumns = root.querySelector<HTMLElement>('.workspace-columns')!
  const recentsListRoot = root.querySelector<HTMLElement>('[data-testid="recents-list"]')!
  const projectsRailList = root.querySelector<HTMLElement>('[data-testid="projects-rail-list"]')!
  const workspaceEl = root.querySelector<HTMLElement>('.workspace')!
  const sortSelect = root.querySelector<HTMLSelectElement>('#recents-sort')!
  const groupSelect = root.querySelector<HTMLSelectElement>('#recents-grouping')!
  const contextMenu = root.querySelector<HTMLElement>('#recents-context-menu')!
  const externalBanner = root.querySelector<HTMLElement>('#external-file-banner')!
  const dirtyIndicator = root.querySelector<HTMLElement>('#dirty-indicator')!
  const currentFileLabel = root.querySelector<HTMLElement>('#current-file-label')!
  const recentsResizer = root.querySelector<HTMLElement>('.recents-resizer')!
  const modeButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-view-mode]')]

  attachPreviewChrome(previewEl)

  let suppressEditorScrollFromSync = false
  let suppressPreviewScrollFromSync = false
  const SCROLL_SYNC_EPSILON = 0.001

  function releaseScrollSyncSuppression(next: 'editor' | 'preview'): void {
    requestAnimationFrame(() => {
      if (next === 'editor') suppressEditorScrollFromSync = false
      else suppressPreviewScrollFromSync = false
    })
  }

  function syncScrollFractionIfNeeded(target: HTMLElement, sourceFraction: number): void {
    if (Math.abs(getScrollFraction(target) - sourceFraction) <= SCROLL_SYNC_EPSILON) return
    setScrollFraction(target, sourceFraction)
  }

  function syncPreviewFromEditor(): void {
    suppressPreviewScrollFromSync = true
    syncScrollFractionIfNeeded(previewEl, getScrollFraction(editor))
    releaseScrollSyncSuppression('preview')
  }

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
  let currentViewMode: 'split' | 'preview' | 'edit' = 'split'
  let isCurrentDocMarkdownCapable = true

  function isPreviewAllowed(): boolean {
    return isCurrentDocMarkdownCapable
  }

  function applyViewMode(mode: 'split' | 'preview' | 'edit'): void {
    const effectiveMode = isPreviewAllowed() ? mode : 'edit'
    currentViewMode = effectiveMode
    workspaceColumns.dataset.viewMode = effectiveMode
    workspaceColumns.dataset.previewAllowed = isPreviewAllowed() ? 'true' : 'false'
    for (const btn of modeButtons) {
      const btnMode = btn.dataset.viewMode
      const enabled = isPreviewAllowed() || btnMode === 'edit'
      btn.disabled = !enabled
      btn.setAttribute('aria-disabled', enabled ? 'false' : 'true')
      btn.hidden = !enabled
      btn.setAttribute('aria-pressed', btnMode === effectiveMode ? 'true' : 'false')
    }
  }

  function schedulePreviewMaybe(): void {
    if (!isPreviewAllowed()) return
    schedulePreview()
  }

  function flushPreviewMaybe(): void {
    if (!isPreviewAllowed()) {
      previewEl.innerHTML = ''
      return
    }
    schedulePreview.flush()
  }

  async function runPreview(): Promise<void> {
    const seq = ++previewSeq
    const st = store.getState()
    const project = selectActiveProject(st)
    const docPath =
      project.currentDocumentId !== null
        ? project.documentsById.get(project.currentDocumentId)?.path ?? null
        : null
    if (!isMarkdownCapableDocumentPath(docPath)) {
      previewEl.innerHTML = ''
      return
    }
    const parseResult = services.parser.parse(st.editorContent)

    let html: string
    if (!parseResult.ok) {
      html = previewErrorSnippet(parseResult.error.message)
    } else {
      const rr = services.renderer.render(parseResult.ast)
      html = rr.ok ? rr.html : previewErrorSnippet(rr.error.message)
    }

    if (seq !== previewSeq) return

    await mountPreview(previewEl, html, docPath, specOps)

    if (seq !== previewSeq) return
    syncPreviewFromEditor()
  }

  const schedulePreview = debounce(() => void runPreview(), 250)

  /** Undo/redo owns Ctrl/Cmd+Z when the stack applies; avoid mixing with native textarea undo. */
  const HISTORY_DEPTH = 75
  const editorHistory = createEditorHistory(HISTORY_DEPTH)
  let suppressHistory = false
  let prevHistoryDocId: string | null = selectActiveProject(store.getState()).currentDocumentId

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
    schedulePreviewMaybe()
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
    flushPreviewMaybe()
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
    const project = selectActiveProject(st)
    const doc = project.documentsById.get(docId)
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
    const project = selectActiveProject(store.getState())
    sortSelect.value = project.fileListSort
    groupSelect.value = project.fileListGrouping
  }

  let prevSelection: string | null | undefined

  async function syncWatchPath(): Promise<void> {
    const st = store.getState()
    const path = selectCurrentDocumentPath(st)
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
    flushPreviewMaybe()
  }

  function currentFileDisplay(
    doc:
      | {
          title: string
          path: string | null
        }
      | undefined
  ): string {
    const path = doc?.path?.trim()
    if (path) return pathBasename(path)
    const title = doc?.title?.trim()
    return title || 'Untitled'
  }

  function formatOpenReadFailure(reason: string): string {
    switch (reason) {
      case 'too_large':
        return 'Could not open file: file exceeds 2 MB text limit.'
      case 'binary':
        return 'Could not open file: binary files are not supported in the editor.'
      case 'unreadable':
        return 'Could not open file: file is not readable as UTF-8 text.'
      case 'invalid_path':
        return 'Could not open file: invalid path.'
      default:
        return 'Could not open file (read error).'
    }
  }

  async function openTextFromAbsolutePath(absPath: string): Promise<void> {
    const read = await specOps.readTextFile(absPath)
    if (!read.ok) {
      window.alert(formatOpenReadFailure(read.reason))
      return
    }
    openLoadedDocument(absPath, read.content, read.mtimeIso)
  }

  function openFilePicker(): void {
    void runAfterDirtyPrompt(async () => {
      const pick = await specOps.pickOpenFile()
      if (pick.canceled) return
      await openTextFromAbsolutePath(pick.filePath)
    })
  }

  function openNewUntitled(): void {
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
      flushPreviewMaybe()
    })
  }

  function markdownTitleFromPath(absPath: string): string {
    return pathBasename(absPath).replace(/\.(md|markdown)$/i, '') || pathBasename(absPath)
  }

  async function refreshProjectMarkdownRecents(projectId: string): Promise<void> {
    const st = store.getState()
    const project = st.projectsById.get(projectId)
    const rootFolder = project?.workspaceFolderPath?.trim()
    const scanFolders = st.markdownScanRelativeFolders
    if (!rootFolder || scanFolders.length === 0) return

    const pathSet = new Set<string>()
    for (const rel of scanFolders) {
      const scanRoot = resolveContainedScanRoot(rootFolder, rel)
      if (!scanRoot) continue
      const listed = await listMarkdownFilesRecursive(scanRoot)
      for (const p of listed) pathSet.add(p)
    }
    const paths = [...pathSet].sort((a, b) => a.localeCompare(b))
    if (!paths.length) return
    const docs: DocumentInput[] = []
    for (const absPath of paths) {
      const id = stableDocIdForPath(absPath)
      const loaded = await specOps.readTextFile(absPath)
      if (!loaded.ok) continue
      docs.push({
        id,
        title: markdownTitleFromPath(absPath),
        content: loaded.content,
        path: absPath,
        lastModified: loaded.mtimeIso
      })
    }
    if (!docs.length) return
    store.dispatch({
      type: 'UPSERT_PROJECT_DOCUMENTS',
      projectId,
      documents: docs
    })
  }

  async function saveCurrentBuffer(): Promise<boolean> {
    const st = store.getState()
    const project = selectActiveProject(st)
    const id = project.currentDocumentId
    if (!id) return false
    const doc = project.documentsById.get(id)
    if (!doc) return false
    const body = project.editorContent
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
      flushPreviewMaybe()
      void specOps.clearDraft(id)
      return true
    }
    const defaultExt = doc.path?.toLowerCase().endsWith('.md') ? '.md' : ''
    const pick = await specOps.pickSaveFile({
      defaultPath: doc.title ? `${doc.title}${defaultExt}` : undefined
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
    flushPreviewMaybe()
    void specOps.clearDraft(id)
    return true
  }

  async function saveCurrentBufferAs(): Promise<boolean> {
    const st = store.getState()
    const project = selectActiveProject(st)
    const id = project.currentDocumentId
    if (!id) return false
    const doc = project.documentsById.get(id)
    if (!doc) return false
    const body = project.editorContent
    const defaultExt = doc.path?.toLowerCase().endsWith('.md') ? '.md' : ''
    const pick = await specOps.pickSaveFile({
      defaultPath: doc.path ?? (doc.title ? `${doc.title}${defaultExt}` : undefined)
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
    flushPreviewMaybe()
    return true
  }

  const scheduleDraftWrite = debounce(() => {
    const st = store.getState()
    const project = selectActiveProject(st)
    const id = project.currentDocumentId
    if (!id || !isEditorDirty(st)) return
    void specOps.writeDraft({ documentId: id, content: project.editorContent })
  }, 750)

  const scheduleAutosave = debounce(() => {
    void saveCurrentBuffer()
  }, 1000)

  async function runAfterDirtyPrompt(action: () => void | Promise<void>): Promise<void> {
    const st = store.getState()
    const project = selectActiveProject(st)
    if (!isEditorDirty(st)) {
      await Promise.resolve(action())
      return
    }
    const choice = await specOps.promptDirtyNavigation()
    if (choice === 'cancel') return
    if (choice === 'discard') {
      const sid = project.currentDocumentId
      if (sid) {
        void specOps.clearDraft(sid)
        const d = project.documentsById.get(sid)
        if (d) store.dispatch({ type: 'EDITOR_CHANGE', content: d.content })
      }
      await Promise.resolve(action())
      return
    }
    const saved = await saveCurrentBuffer()
    if (!saved) return
    await Promise.resolve(action())
  }

  wireProjectSwitcher({
    root,
    store,
    specOps,
    runAfterDirtyPrompt,
    onProjectActivated: (projectId) => refreshProjectMarkdownRecents(projectId)
  })

  function collectDroppedMarkdownPaths(dt: DataTransfer | null): string[] {
    const out: string[] = []
    const files = dt?.files
    if (!files?.length) return out
    for (let i = 0; i < files.length; i++) {
      const raw = getPathForDroppedFile(files[i]!)
      if (!raw) continue
      const lower = raw.toLowerCase()
      if (lower.endsWith('.md') || lower.endsWith('.markdown')) out.push(raw)
    }
    return out
  }

  function miscPickWorkspaceFolder(): void {
    void (async () => {
      const picked = await specOps.pickWorkspaceFolder()
      store.dispatch({ type: 'SET_WORKSPACE_FOLDER', path: picked })
    })()
  }

  function miscNewTextFileInWorkspace(): void {
    void runAfterDirtyPrompt(async () => {
      const folder = selectActiveProject(store.getState()).workspaceFolderPath
      if (!folder) {
        window.alert('Choose a workspace folder first.')
        return
      }
      const raw = window.prompt('New text file name', 'notes.md')
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
      flushPreviewMaybe()
    })
  }

  function miscSeedDemos(): void {
    void runAfterDirtyPrompt(() => {
      const t0 = new Date().toISOString()
      store.dispatch({ type: 'OPEN_EXPLICIT', document: SAMPLE_DOC_B }, t0)
      store.dispatch({ type: 'OPEN_EXPLICIT', document: SAMPLE_DOC_A }, t0)
      flushPreviewMaybe()
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
      flushPreviewMaybe()
    })
  }

  function syncShellFromStore(): void {
    const st = store.getState()
    const projectButtons = [...st.projectsById.entries()]
      .sort((a, b) => {
        if (a[0] === 'default') return -1
        if (b[0] === 'default') return 1
        return a[0].localeCompare(b[0])
      })
      .map(([id, project]) => {
        const rawPath = project.workspaceFolderPath?.trim()
        const letter =
          (rawPath ? pathBasename(rawPath) : id === 'default' ? 'D' : 'P').trim().charAt(0).toUpperCase() ||
          'P'
        const title = rawPath || (id === 'default' ? 'Notepad' : 'Project')
        const activeClass = id === st.activeProjectId ? ' project-rail-btn--active' : ''
        const color = project.accentColor || '#6f7684'
        return `<button type="button" class="project-rail-btn${activeClass}" data-project-id="${id}" title="${title.replace(/"/g, '&quot;')}" style="border-color:${color}">${letter}</button>`
      })
      .join('')
    projectsRailList.innerHTML = projectButtons

    const project = selectActiveProject(st)
    document.documentElement.style.setProperty('--recents-width', `${st.recentsPaneWidthPx}px`)

    if (project.currentDocumentId !== prevHistoryDocId) {
      editorHistory.clear()
      scheduleHistoryPush.cancel()
      prevHistoryDocId = project.currentDocumentId
    }
    if (editor.value !== project.editorContent) {
      suppressHistory = true
      editor.value = project.editorContent
      suppressHistory = false
      scheduleHistoryPush.cancel()
      refreshLineGutter()
    }

    editor.classList.toggle('editor-field--wrap', st.editorSoftWrap)
    editorStack.classList.toggle('editor-stack--wrap', st.editorSoftWrap)
    lineGutter.hidden = !st.editorLineNumbers
    if (st.editorLineNumbers) refreshLineGutter()

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
    if (prevDirty && !dirty && project.currentDocumentId) {
      void specOps.clearDraft(project.currentDocumentId)
    }
    prevDirty = dirty
    if (dirty && project.currentDocumentId) {
      scheduleDraftWrite()
    }

    const doc = project.currentDocumentId
      ? project.documentsById.get(project.currentDocumentId)
      : undefined
    isCurrentDocMarkdownCapable = isMarkdownCapableDocumentPath(doc?.path ?? null)
    if (!isCurrentDocMarkdownCapable && currentViewMode !== 'edit') {
      currentViewMode = 'edit'
    }
    applyViewMode(currentViewMode)
    const currentName = currentFileDisplay(doc)
    currentFileLabel.textContent = currentName
    currentFileLabel.title = currentName
    if (st.autosaveEnabled && doc?.path?.trim() && dirty) {
      scheduleAutosave()
    }

    syncSelectsFromState()
    renderRecents(recentsListRoot, st)

    if (prevSelection !== undefined && prevSelection !== project.currentDocumentId) {
      triggerWorkspaceMotion(workspaceEl)
      void syncWatchPath()
      flushPreviewMaybe()
    }
    prevSelection = project.currentDocumentId

    root.dataset.currentDocId = project.currentDocumentId ?? ''

    refreshEditorHighlight()
  }

  store.subscribe(syncShellFromStore)

  let prevScanFoldersJson = JSON.stringify(store.getState().markdownScanRelativeFolders)
  store.subscribe(() => {
    const next = JSON.stringify(store.getState().markdownScanRelativeFolders)
    if (next === prevScanFoldersJson) return
    prevScanFoldersJson = next
    for (const pid of store.getState().projectsById.keys()) {
      void refreshProjectMarkdownRecents(pid)
    }
  })

  syncShellFromStore()
  applyViewMode(currentViewMode)
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
    schedulePreviewMaybe()
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
    schedulePreviewMaybe()
    scheduleHistoryPush()
    scheduleDraftWrite()
  })

  editor.addEventListener('scroll', () => {
    lineGutter.scrollTop = editor.scrollTop
    syncEditorHighlightScroll()
    if (suppressEditorScrollFromSync) return
    if (!isPreviewAllowed()) return
    suppressPreviewScrollFromSync = true
    syncScrollFractionIfNeeded(previewEl, getScrollFraction(editor))
    releaseScrollSyncSuppression('preview')
  })

  previewEl.addEventListener('scroll', () => {
    if (suppressPreviewScrollFromSync) return
    suppressEditorScrollFromSync = true
    syncScrollFractionIfNeeded(editor, getScrollFraction(previewEl))
    lineGutter.scrollTop = editor.scrollTop
    syncEditorHighlightScroll()
    releaseScrollSyncSuppression('editor')
  })

  findInput.addEventListener('input', () => refreshFindPatternError())
  findRegex.addEventListener('change', () => refreshFindPatternError())
  findCase.addEventListener('change', () => refreshFindPatternError())

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
      requestAnimationFrame(() => flushPreviewMaybe())
    })
  })

  projectsRailList.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-project-id]')
    const id = btn?.dataset.projectId
    if (!id) return
    void runAfterDirtyPrompt(async () => {
      store.dispatch({ type: 'SET_ACTIVE_PROJECT', projectId: id })
      await refreshProjectMarkdownRecents(id)
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
    const project = selectActiveProject(st)
    const doc = project.documentsById.get(contextDocId)
    hideContextMenu()
    if (!doc) return

    switch (btn.dataset.action) {
      case 'reveal':
        if (doc.path) void specOps.revealInFolder(doc.path)
        break
      case 'remove':
        store.dispatch({ type: 'REMOVE_FROM_RECENTS', documentId: doc.id })
        flushPreviewMaybe()
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
          const latestProject = selectActiveProject(latest)
          const d = latestProject.documentsById.get(doc.id)
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
            content: latestProject.editorContent,
            lastModified: rn.mtimeIso
          })
          void syncWatchPath()
          flushPreviewMaybe()
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
          flushPreviewMaybe()
        })()
        break
      }
      default:
        break
    }
  })

  // Bubble phase only: capture-phase would run before the menu item's click handler and clear
  // `contextDocId`, making every context-menu action a no-op (see REMOVE_FROM_RECENTS, etc.).
  document.body.addEventListener('click', () => {
    hideContextMenu()
  })

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

  for (const btn of modeButtons) {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.viewMode
      if (mode === 'split' || mode === 'preview' || mode === 'edit') {
        if (!isPreviewAllowed() && mode !== 'edit') return
        applyViewMode(mode)
      }
    })
  }

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
    void runAfterDirtyPrompt(() => openTextFromAbsolutePath(first))
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
    executeMenuCommand(cmd, {
      openFile: openFilePicker,
      newUntitled: openNewUntitled,
      save: () => {
        void saveCurrentBuffer()
      },
      saveAs: () => {
        void saveCurrentBufferAs()
      },
      miscWorkspaceFolder: miscPickWorkspaceFolder,
      miscNewTextFile: miscNewTextFileInWorkspace,
      miscSeedDemos: miscSeedDemos,
      miscOpenFixture: miscOpenFixture,
      find: toggleFindPanelShortcut,
      findReplace: openReplacePanelShortcut
    })
  })

  if (typeof specOps.onProjectsCleared === 'function') {
    specOps.onProjectsCleared(() => {
      store.dispatch({ type: 'CLEAR_NON_DEFAULT_PROJECTS' })
    })
  }

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
        flushPreviewMaybe()
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
    const project = selectActiveProject(st)
    const docId = documentIdForAbsolutePath(st, payload.path)
    if (!docId) return
    const isCurrent = project.currentDocumentId === docId
    if (isCurrent && isEditorDirty(st)) {
      if (payload.content === project.editorContent) {
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
    flushPreviewMaybe()
  })

  for (const projectId of store.getState().projectsById.keys()) {
    void refreshProjectMarkdownRecents(projectId)
  }
  void runPreview()
}

