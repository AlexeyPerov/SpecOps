// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppServices } from '../src/app/services'
import { createAppStore } from '../src/core/state/store'
import type { SpecOpsPreloadApi } from '../src/preload/specOpsApi'
import { bootRenderer } from '../src/renderer/boot/rendererBoot'

const mockSpecOps: SpecOpsPreloadApi = {
  ping: () => 'pong',
  getAppVersion: () => '0-test',
  getPlatform: () => 'darwin',
  resolveRepoPath: vi.fn(async (...segments: string[]) => '/virtual/' + segments.join('/')),
  readMarkdownAsset: vi.fn(async () => ({ ok: false as const, reason: 'stub' })),
  pickWorkspaceFolder: vi.fn(async () => null),
  revealInFolder: vi.fn(async () => {}),
  readTextFile: vi.fn(async () => ({ ok: false as const, reason: 'stub' })),
  createMarkdownInWorkspace: vi.fn(async () => ({ ok: false as const, reason: 'stub' })),
  setWatchedDocPath: vi.fn(async () => {}),
  onExternalFileChanged: vi.fn(() => () => {}),
  writeTextFile: vi.fn(async () => ({ ok: true as const, mtimeIso: '2026-01-01T00:00:00.000Z' })),
  pickOpenMarkdownFile: vi.fn(async () => ({ canceled: true as const })),
  pickSaveMarkdownFile: vi.fn(async () => ({ canceled: true as const })),
  promptDirtyNavigation: vi.fn(async () => 'discard' as const),
  confirmDeleteFile: vi.fn(async () => false),
  renamePathOnDisk: vi.fn(async () => ({ ok: false as const, reason: 'stub' })),
  unlinkFilePath: vi.fn(async () => ({ ok: false as const, reason: 'stub' }))
}

describe('UPH-01 shell (TEST-02 harness)', () => {
  beforeEach(() => {
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

  it('seed demos then activate recent updates editor buffer', async () => {
    const root = document.getElementById('app')!
    const store = createAppStore()
    bootRenderer({
      root,
      store,
      services: createAppServices(),
      specOps: mockSpecOps
    })

    document.querySelector<HTMLButtonElement>('#btn-seed-demos')!.click()

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
})
