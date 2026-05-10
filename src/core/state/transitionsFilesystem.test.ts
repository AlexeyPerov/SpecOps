import { describe, expect, it } from 'vitest'

import type { Document } from './types'
import { createInitialAppState, reduceAppState } from './transitions'

function doc(partial: Partial<Document> & Pick<Document, 'id'>): Document {
  return {
    title: partial.title ?? partial.id,
    content: partial.content ?? '',
    lastOpened: partial.lastOpened ?? '2026-05-09T00:00:00.000Z',
    path: partial.path ?? null,
    lastModified: partial.lastModified ?? null,
    ...partial
  }
}

describe('REPARENT_DOCUMENT', () => {
  const t0 = '2026-05-09T12:00:00.000Z'

  it('moves document id and path while preserving editor selection', () => {
    let s = createInitialAppState()
    const oldId = '/tmp/old.md'.replace(/\\/g, '/')
    const d = doc({
      id: oldId,
      title: 'old',
      content: 'body',
      path: '/tmp/old.md',
      lastModified: 'old'
    })
    s = reduceAppState(s, { type: 'OPEN_EXPLICIT', document: d }, t0)
    s = reduceAppState(s, { type: 'EDITOR_CHANGE', content: 'edited' }, t0)

    s = reduceAppState(
      s,
      {
        type: 'REPARENT_DOCUMENT',
        oldDocumentId: oldId,
        newAbsolutePath: '/tmp/new.md',
        content: 'edited',
        lastModified: 'newmtime'
      },
      t0
    )

    const newId = '/tmp/new.md'.replace(/\\/g, '/')
    expect(s.documentsById.has(oldId)).toBe(false)
    expect(s.documentsById.get(newId)?.path).toBe('/tmp/new.md')
    expect(s.documentsById.get(newId)?.title).toBe('new')
    expect(s.currentDocumentId).toBe(newId)
    expect(s.editorContent).toBe('edited')
    expect(s.recentDocumentIds.includes(newId)).toBe(true)
  })
})

describe('DROP_DOCUMENT', () => {
  const t0 = '2026-05-09T12:00:00.000Z'

  it('removes document from map and recents', () => {
    let s = createInitialAppState()
    s = reduceAppState(s, { type: 'OPEN_EXPLICIT', document: doc({ id: 'a', content: 'A' }) }, t0)
    s = reduceAppState(s, { type: 'OPEN_EXPLICIT', document: doc({ id: 'b', content: 'B' }) }, t0)
    s = reduceAppState(s, { type: 'DROP_DOCUMENT', documentId: 'a' }, t0)

    expect(s.documentsById.has('a')).toBe(false)
    expect(s.recentDocumentIds).toEqual(['b'])
    expect(s.currentDocumentId).toBe('b')
  })
})
