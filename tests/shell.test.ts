// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppServices } from '../src/app/services'
import { createAppStore } from '../src/core/state/store'
import { createInitialAppState } from '../src/core/state/transitions'
import { DEFAULT_PREFERENCES_V1 } from '../src/core/state/sessionCodec'
import type { SpecOpsPreloadApi } from '../src/preload/specOpsApi'
import { bootRenderer } from '../src/renderer/boot/rendererBoot'
import { SPEC_OPS_MENU_COMMANDS } from '../src/ipc/specOpsIpc'

let lastMenuListener: ((commandId: Parameters<SpecOpsPreloadApi['onMenuCommand']>[0] extends (arg: infer T) => void ? T : never) => void) | null = null

const mockSpecOps: SpecOpsPreloadApi = {
  ping: () => 'pong',
  getAppVersion: () => '0-test',
  getPlatform: () => 'darwin',
  resolveRepoPath: vi.fn(async (...segments: string[]) => '/virtual/' + segments.join('/')),
  readMarkdownAsset: vi.fn(async () => ({ ok: false as const, reason: 'stub' })),
  pickWorkspaceFolder: vi.fn(async () => null),
  getPathForFile: vi.fn(() => null),
  revealInFolder: vi.fn(async () => {}),
  readTextFile: vi.fn(async () => ({ ok: false as const, reason: 'stub' })),
  createMarkdownInWorkspace: vi.fn(async () => ({ ok: false as const, reason: 'stub' })),
  listMarkdownFilesRecursive: vi.fn(async () => []),
  setWatchedDocPath: vi.fn(async () => {}),
  onExternalFileChanged: vi.fn(() => () => {}),
  writeTextFile: vi.fn(async () => ({ ok: true as const, mtimeIso: '2026-01-01T00:00:00.000Z' })),
  pickOpenFile: vi.fn(async () => ({ canceled: true as const })),
  pickSaveFile: vi.fn(async () => ({ canceled: true as const })),
  promptDirtyNavigation: vi.fn(async () => 'discard' as const),
  confirmDeleteFile: vi.fn(async () => false),
  renamePathOnDisk: vi.fn(async () => ({ ok: false as const, reason: 'stub' })),
  unlinkFilePath: vi.fn(async () => ({ ok: false as const, reason: 'stub' })),
  readPreferences: vi.fn(async () => DEFAULT_PREFERENCES_V1),
  writePreferences: vi.fn(async () => {}),
  readSession: vi.fn(async () => null),
  writeSession: vi.fn(async () => {}),
  clearProjects: vi.fn(async () => {}),
  readDraft: vi.fn(async () => null),
  writeDraft: vi.fn(async () => {}),
  clearDraft: vi.fn(async () => {}),
  listDraftIds: vi.fn(async () => []),
  promptDraftRecovery: vi.fn(async () => 'discard' as const),
  onMenuCommand: vi.fn((cb) => {
    lastMenuListener = cb
    return () => {
      lastMenuListener = null
    }
  }),
  notifyPreferencesChanged: vi.fn(),
  onPreferencesChanged: vi.fn(() => () => {}),
  onProjectsCleared: vi.fn(() => () => {})
}

describe('UPH-01 shell (TEST-02 harness)', () => {
  beforeEach(() => {
    lastMenuListener = null
    document.documentElement.dataset.theme = 'light'
    Object.defineProperty(window, 'specOps', { value: mockSpecOps, configurable: true })
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: String(query).includes('dark') ? false : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    })
    document.body.innerHTML = '<main id="app" class="shell"></main>'
  })

  it('exposes recents, editor, and preview regions', () => {
    const root = document.getElementById('app')!
    bootRenderer({
      root,
      store: createAppStore(),
      services: createAppServices(),
      specOps: mockSpecOps
    })

    expect(document.querySelector('[data-testid="recents-pane"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="editor"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="preview"]')).toBeTruthy()
  })

  it('syncs initial editor buffer from store when a document is already selected', () => {
    const root = document.getElementById('app')!
    const doc = {
      id: 'a',
      title: 'A',
      content: '# Hello from initial state',
      lastOpened: '2026-01-01T00:00:00.000Z',
      path: null,
      lastModified: null
    }
    const base = createInitialAppState()
    const active = base.projectsById.get(base.activeProjectId)!
    const projectsById = new Map(base.projectsById)
    projectsById.set(base.activeProjectId, {
      ...active,
      documentsById: new Map([[doc.id, doc]]),
      recentDocumentIds: [doc.id],
      currentDocumentId: doc.id,
      editorContent: doc.content
    })
    const store = createAppStore({
      ...base,
      projectsById,
      documentsById: new Map([[doc.id, doc]]),
      recentDocumentIds: [doc.id],
      currentDocumentId: doc.id,
      editorContent: doc.content
    })
    bootRenderer({
      root,
      store,
      services: createAppServices(),
      specOps: mockSpecOps
    })

    expect((document.querySelector('[data-testid="editor"]') as HTMLTextAreaElement).value).toBe(
      '# Hello from initial state'
    )
  })

  it('seed demos via File ▸ Misc menu updates editor buffer', async () => {
    const root = document.getElementById('app')!
    const store = createAppStore()
    bootRenderer({
      root,
      store,
      services: createAppServices(),
      specOps: mockSpecOps
    })

    expect(lastMenuListener).toBeTypeOf('function')
    lastMenuListener!(SPEC_OPS_MENU_COMMANDS.miscSeedDemos)

    await vi.waitFor(() => {
      expect((document.querySelector('[data-testid="editor"]') as HTMLTextAreaElement).value).toContain(
        'Alpha'
      )
    })

    const docBbtn = [...document.querySelectorAll<HTMLButtonElement>('.recent-item')].find((b) =>
      b.textContent?.includes('Doc B')
    )
    expect(docBbtn).toBeTruthy()
    docBbtn!.click()

    await vi.waitFor(() => {
      expect((document.querySelector('[data-testid="editor"]') as HTMLTextAreaElement).value).toContain(
        'Bravo'
      )
    })
  })

  it('forces editor-only mode for non-markdown docs and shows current file label', async () => {
    const root = document.getElementById('app')!
    const doc = {
      id: 'txt-1',
      title: 'notes.txt',
      content: 'plain text',
      lastOpened: '2026-01-01T00:00:00.000Z',
      path: '/tmp/notes.txt',
      lastModified: null
    }
    const base = createInitialAppState()
    const active = base.projectsById.get(base.activeProjectId)!
    const projectsById = new Map(base.projectsById)
    projectsById.set(base.activeProjectId, {
      ...active,
      documentsById: new Map([[doc.id, doc]]),
      recentDocumentIds: [doc.id],
      currentDocumentId: doc.id,
      editorContent: doc.content
    })
    const store = createAppStore({
      ...base,
      projectsById,
      documentsById: new Map([[doc.id, doc]]),
      recentDocumentIds: [doc.id],
      currentDocumentId: doc.id,
      editorContent: doc.content
    })
    bootRenderer({
      root,
      store,
      services: createAppServices(),
      specOps: mockSpecOps
    })

    await vi.waitFor(() => {
      const workspace = document.querySelector<HTMLElement>('.workspace-columns')!
      expect(workspace.dataset.viewMode).toBe('edit')
      expect(workspace.dataset.previewAllowed).toBe('false')
    })

    const splitBtn = document.querySelector<HTMLButtonElement>('button[data-view-mode="split"]')!
    const previewBtn = document.querySelector<HTMLButtonElement>('button[data-view-mode="preview"]')!
    const editBtn = document.querySelector<HTMLButtonElement>('button[data-view-mode="edit"]')!
    expect(splitBtn.hidden).toBe(true)
    expect(previewBtn.hidden).toBe(true)
    expect(editBtn.hidden).toBe(false)

    const fileLabel = document.querySelector<HTMLElement>('#current-file-label')!
    expect(fileLabel.textContent).toBe('notes.txt')
  })

  it('keeps untitled docs markdown-capable', async () => {
    const root = document.getElementById('app')!
    const doc = {
      id: 'untitled-1',
      title: 'Untitled',
      content: '# Heading',
      lastOpened: '2026-01-01T00:00:00.000Z',
      path: null,
      lastModified: null
    }
    const base = createInitialAppState()
    const active = base.projectsById.get(base.activeProjectId)!
    const projectsById = new Map(base.projectsById)
    projectsById.set(base.activeProjectId, {
      ...active,
      documentsById: new Map([[doc.id, doc]]),
      recentDocumentIds: [doc.id],
      currentDocumentId: doc.id,
      editorContent: doc.content
    })
    const store = createAppStore({
      ...base,
      projectsById,
      documentsById: new Map([[doc.id, doc]]),
      recentDocumentIds: [doc.id],
      currentDocumentId: doc.id,
      editorContent: doc.content
    })
    bootRenderer({
      root,
      store,
      services: createAppServices(),
      specOps: mockSpecOps
    })

    await vi.waitFor(() => {
      const workspace = document.querySelector<HTMLElement>('.workspace-columns')!
      expect(workspace.dataset.previewAllowed).toBe('true')
    })

    const splitBtn = document.querySelector<HTMLButtonElement>('button[data-view-mode="split"]')!
    const previewBtn = document.querySelector<HTMLButtonElement>('button[data-view-mode="preview"]')!
    expect(splitBtn.hidden).toBe(false)
    expect(previewBtn.hidden).toBe(false)
  })
})
