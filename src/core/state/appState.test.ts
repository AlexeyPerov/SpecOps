import { describe, expect, it } from 'vitest'

import type { DocumentInput } from './types'
import { createInitialAppState, reduceAppState } from './transitions'

function doc(partial: Partial<DocumentInput> & { id: string }): DocumentInput {
  return {
    ...partial,
    title: partial.title ?? 't',
    content: partial.content ?? '',
    path: partial.path ?? null,
    lastModified: partial.lastModified ?? null,
    saveIntentDirectory: partial.saveIntentDirectory ?? null
  }
}

describe('reduceAppState', () => {
  const t0 = '2026-05-09T10:00:00.000Z'
  const t1 = '2026-05-09T11:00:00.000Z'
  const t2 = '2026-05-09T12:00:00.000Z'

  it('explicit open prepends MRU and bumps lastOpened', () => {
    let state = createInitialAppState()
    state = reduceAppState(state, { type: 'OPEN_EXPLICIT', document: doc({ id: 'a', content: 'A', lastOpened: t0 }) }, t1)
    state = reduceAppState(state, { type: 'OPEN_EXPLICIT', document: doc({ id: 'b', content: 'B', lastOpened: t0 }) }, t2)

    expect(state.recentDocumentIds).toEqual(['b', 'a'])
    expect(state.currentDocumentId).toBe('b')
    expect(state.editorContent).toBe('B')
    expect(state.documentsById.get('a')!.lastOpened).toBe(t1)
    expect(state.documentsById.get('b')!.lastOpened).toBe(t2)
  })

  it('dedupes recents when reopening same id explicitly', () => {
    let state = createInitialAppState()
    state = reduceAppState(state, { type: 'OPEN_EXPLICIT', document: doc({ id: 'a', content: 'A1' }) }, t0)
    state = reduceAppState(state, { type: 'OPEN_EXPLICIT', document: doc({ id: 'b', content: 'B' }) }, t1)
    state = reduceAppState(state, { type: 'OPEN_EXPLICIT', document: doc({ id: 'a', content: 'A2' }) }, t2)

    expect(state.recentDocumentIds).toEqual(['a', 'b'])
    expect(state.documentsById.get('a')!.content).toBe('A2')
    expect(state.documentsById.get('a')!.lastOpened).toBe(t2)
  })

  it('recent-list activation does not reorder recents or bump lastOpened', () => {
    let state = createInitialAppState()
    state = reduceAppState(state, { type: 'OPEN_EXPLICIT', document: doc({ id: 'a', content: 'A' }) }, t0)
    state = reduceAppState(state, { type: 'OPEN_EXPLICIT', document: doc({ id: 'b', content: 'B' }) }, t1)

    const lastOpenedBefore = state.documentsById.get('a')!.lastOpened

    state = reduceAppState(state, { type: 'ACTIVATE_FROM_RECENT_LIST', documentId: 'a' }, t2)

    expect(state.recentDocumentIds).toEqual(['b', 'a'])
    expect(state.documentsById.get('a')!.lastOpened).toBe(lastOpenedBefore)
    expect(state.currentDocumentId).toBe('a')
    expect(state.editorContent).toBe('A')
  })

  it('ACTIVATE_FROM_RECENT_LIST is no-op for unknown id', () => {
    let state = createInitialAppState()
    state = reduceAppState(state, { type: 'OPEN_EXPLICIT', document: doc({ id: 'a', content: 'A' }) }, t0)
    const before = state
    state = reduceAppState(state, { type: 'ACTIVATE_FROM_RECENT_LIST', documentId: 'missing' }, t1)
    expect(state).toEqual(before)
  })

  it('EDITOR_CHANGE updates buffer only', () => {
    let state = createInitialAppState()
    state = reduceAppState(state, { type: 'OPEN_EXPLICIT', document: doc({ id: 'a', content: 'A' }) }, t0)
    state = reduceAppState(state, { type: 'EDITOR_CHANGE', content: 'edited' }, t1)
    expect(state.editorContent).toBe('edited')
    expect(state.documentsById.get('a')!.content).toBe('A')
  })

  it('SET_THEME_MODE updates theme preference only', () => {
    let state = createInitialAppState()
    expect(state.themeMode).toBe('system')
    expect(state.fileListGrouping).toBe('folder')
    state = reduceAppState(state, { type: 'SET_THEME_MODE', mode: 'dark' }, t0)
    expect(state.themeMode).toBe('dark')
    expect(state.documentsById.size).toBe(0)
  })

  it('clamps editor/preview font sizes to allowed bounds', () => {
    let state = createInitialAppState()
    state = reduceAppState(state, { type: 'SET_EDITOR_FONT_SIZE_PX', sizePx: 9 }, t0)
    state = reduceAppState(state, { type: 'SET_PREVIEW_FONT_SIZE_PX', sizePx: 25 }, t0)
    expect(state.editorFontSizePx).toBe(10)
    expect(state.previewFontSizePx).toBe(24)
  })

  it('creates/switches/removes projects with isolated recents', () => {
    let state = createInitialAppState()
    state = reduceAppState(state, { type: 'OPEN_EXPLICIT', document: doc({ id: 'a', content: 'A' }) }, t0)
    state = reduceAppState(
      state,
      { type: 'CREATE_PROJECT', projectId: 'p2', workspaceFolderPath: '/workspace/p2' },
      t1
    )
    state = reduceAppState(state, { type: 'SET_ACTIVE_PROJECT', projectId: 'p2' }, t1)
    expect(state.currentDocumentId).toBeNull()
    expect(state.recentDocumentIds).toEqual([])
    expect(state.workspaceFolderPath).toBe('/workspace/p2')
    state = reduceAppState(state, { type: 'OPEN_EXPLICIT', document: doc({ id: 'b', content: 'B' }) }, t2)
    expect(state.recentDocumentIds).toEqual(['b'])

    state = reduceAppState(state, { type: 'SET_ACTIVE_PROJECT', projectId: 'default' }, t2)
    expect(state.recentDocumentIds).toEqual(['a'])
    expect(state.currentDocumentId).toBe('a')

    state = reduceAppState(state, { type: 'REMOVE_PROJECT', projectId: 'p2' }, t2)
    expect(state.projectsById.has('p2')).toBe(false)
    expect(state.activeProjectId).toBe('default')
  })

  it('SET_PANEL_MODE updates per-project panel mode', () => {
    let state = createInitialAppState()
    expect(state.panelMode).toBe('recents')
    state = reduceAppState(state, { type: 'SET_PANEL_MODE', mode: 'explorer' }, t0)
    expect(state.panelMode).toBe('explorer')
    expect(state.projectsById.get(state.activeProjectId)?.panelMode).toBe('explorer')
  })

  it('UPDATE_UNTITLED_TITLE renames untitled doc without path', () => {
    let state = createInitialAppState()
    state = reduceAppState(state, { type: 'OPEN_EXPLICIT', document: doc({ id: 'a', title: 'Untitled', content: 'hello' }) }, t0)
    expect(state.documentsById.get('a')?.title).toBe('Untitled')
    state = reduceAppState(state, { type: 'UPDATE_UNTITLED_TITLE', documentId: 'a', title: 'hello' }, t1)
    expect(state.documentsById.get('a')?.title).toBe('hello')
  })

  it('UPDATE_UNTITLED_TITLE is no-op for docs with path', () => {
    let state = createInitialAppState()
    state = reduceAppState(state, { type: 'OPEN_EXPLICIT', document: doc({ id: 'a', title: 'MyDoc', content: 'x', path: '/tmp/a.md' }) }, t0)
    state = reduceAppState(state, { type: 'UPDATE_UNTITLED_TITLE', documentId: 'a', title: 'new' }, t1)
    expect(state.documentsById.get('a')?.title).toBe('MyDoc')
  })

  it('REPARENT_DOCUMENT clears saveIntentDirectory', () => {
    let state = createInitialAppState()
    state = reduceAppState(state, { type: 'OPEN_EXPLICIT', document: doc({ id: 'a', title: 'Untitled', content: 'x', saveIntentDirectory: '/tmp/dir' }) }, t0)
    expect(state.documentsById.get('a')?.saveIntentDirectory).toBe('/tmp/dir')
    state = reduceAppState(state, { type: 'REPARENT_DOCUMENT', oldDocumentId: 'a', newAbsolutePath: '/tmp/dir/saved.md', content: 'x', lastModified: t1 }, t1)
    const newId = '/tmp/dir/saved.md'.replace(/\\/g, '/')
    expect(state.documentsById.get(newId)?.saveIntentDirectory).toBeNull()
  })

  it('SET_SCROLL Snapshot stores per-document scroll', () => {
    let state = createInitialAppState()
    state = reduceAppState(state, { type: 'OPEN_EXPLICIT', document: doc({ id: 'a', content: 'A' }) }, t0)
    state = reduceAppState(state, { type: 'SET_SCROLL_SNAPSHOT', documentId: 'a', snapshot: { editorFraction: 0.5, previewFraction: 0.3 } }, t1)
    expect(state.scrollSnapshots.get('a')).toEqual({ editorFraction: 0.5, previewFraction: 0.3 })
  })

  it('SET_EXCLUDE_GIT_DIRECTORY updates global setting', () => {
    let state = createInitialAppState()
    expect(state.excludeGitDirectory).toBe(true)
    state = reduceAppState(state, { type: 'SET_EXCLUDE_GIT_DIRECTORY', enabled: false }, t0)
    expect(state.excludeGitDirectory).toBe(false)
  })

  it('SET_EXCLUDE_NODE_MODULES updates global setting', () => {
    let state = createInitialAppState()
    expect(state.excludeNodeModules).toBe(true)
    state = reduceAppState(state, { type: 'SET_EXCLUDE_NODE_MODULES', enabled: false }, t0)
    expect(state.excludeNodeModules).toBe(false)
  })
})
