import { describe, expect, it } from 'vitest'

import type { DocumentInput } from './types'
import { createInitialAppState, reduceAppState } from './transitions'

function doc(partial: DocumentInput & { id: string }): DocumentInput {
  return {
    title: partial.title ?? 't',
    content: partial.content ?? '',
    path: partial.path ?? null,
    lastModified: partial.lastModified ?? null,
    ...partial
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
    state = reduceAppState(state, { type: 'SET_THEME_MODE', mode: 'dark' }, t0)
    expect(state.themeMode).toBe('dark')
    expect(state.documentsById.size).toBe(0)
  })
})
