import { describe, expect, it } from 'vitest'

import {
  documentIdForAbsolutePath,
  folderKeyForDocumentPath,
  groupsForPresentation,
  isFolderExpanded,
  orderedRecentIds,
  isEditorDirty
} from './fileListPresentation'
import { createInitialAppState, reduceAppState } from './transitions'
import type { AppState, Document } from './types'
import { UNGROUPED_FOLDER_KEY } from './types'

function doc(d: Partial<Document> & Pick<Document, 'id'>): Document {
  return {
    title: d.title ?? d.id,
    content: d.content ?? '',
    lastOpened: d.lastOpened ?? '2026-05-09T00:00:00.000Z',
    path: d.path ?? null,
    lastModified: d.lastModified ?? null,
    saveIntentDirectory: d.saveIntentDirectory ?? null,
    ...d
  }
}

function stateWith(docs: Document[], recentIds: string[], overrides?: Partial<AppState>): AppState {
  const map = new Map(docs.map((d) => [d.id, d]))
  const base = createInitialAppState()
  const active = base.projectsById.get(base.activeProjectId)!
  const projectOverrides = {
    currentDocumentId: overrides?.currentDocumentId ?? active.currentDocumentId,
    editorContent: overrides?.editorContent ?? active.editorContent,
    workspaceFolderPath: overrides?.workspaceFolderPath ?? active.workspaceFolderPath,
    fileListSort: overrides?.fileListSort ?? active.fileListSort,
    fileListGrouping: overrides?.fileListGrouping ?? active.fileListGrouping,
    expandedFolderGroups: overrides?.expandedFolderGroups ?? active.expandedFolderGroups
  }
  const patched = {
    ...active,
    documentsById: map,
    recentDocumentIds: recentIds,
    ...projectOverrides
  }
  const projectsById = new Map(base.projectsById)
  projectsById.set(base.activeProjectId, patched)
  return {
    ...base,
    projectsById,
    documentsById: map,
    recentDocumentIds: recentIds,
    ...overrides,
    currentDocumentId: patched.currentDocumentId,
    editorContent: patched.editorContent,
    workspaceFolderPath: patched.workspaceFolderPath,
    fileListSort: patched.fileListSort,
    fileListGrouping: patched.fileListGrouping,
    expandedFolderGroups: [...patched.expandedFolderGroups]
  }
}

describe('folderKeyForDocumentPath', () => {
  it('maps missing path to ungrouped sentinel', () => {
    expect(folderKeyForDocumentPath(null)).toBe(UNGROUPED_FOLDER_KEY)
  })

  it('maps posix paths to parent folder key', () => {
    expect(folderKeyForDocumentPath('/a/b/c.md')).toBe('/a/b')
  })

  it('normalizes backslashes', () => {
    expect(folderKeyForDocumentPath('C:\\dev\\x\\y.md')).toBe('C:/dev/x')
  })
})

describe('orderedRecentIds', () => {
  const da = doc({
    id: 'a',
    title: 'Zebra',
    content: '',
    path: '/x/z.md'
  })
  const db = doc({
    id: 'b',
    title: 'Alpha',
    content: '',
    path: '/y/a.md'
  })

  it('preserves MRU order for lastOpened sort', () => {
    const s = stateWith([da, db], ['b', 'a'], { fileListSort: 'lastOpened' })
    expect(orderedRecentIds(s)).toEqual(['b', 'a'])
  })

  it('stable-sorts by title case-insensitive', () => {
    const s = stateWith([da, db], ['b', 'a'], { fileListSort: 'title' })
    expect(orderedRecentIds(s)).toEqual(['b', 'a'])
  })

  it('puts documents without path last when sorting by path', () => {
    const dn = doc({ id: 'n', title: 'No path', content: '', path: null })
    const s = stateWith([da, dn], ['n', 'a'], { fileListSort: 'path' })
    expect(orderedRecentIds(s)).toEqual(['a', 'n'])
  })
})

describe('groupsForPresentation', () => {
  const da = doc({ id: 'a', title: 'a', content: '', path: '/p/x/a.md' })
  const db = doc({ id: 'b', title: 'b', content: '', path: '/p/y/b.md' })

  it('returns a flat pseudo-group when grouping is none', () => {
    const s = stateWith([da, db], ['b', 'a'], {
      fileListGrouping: 'none'
    })
    expect(groupsForPresentation(s)).toEqual([
      { key: '_flat', label: '', ids: ['b', 'a'] }
    ])
  })

  it('groups by folder preserving MRU ordering inside buckets', () => {
    const dc = doc({ id: 'c', title: 'c', content: '', path: null })
    const s = stateWith([da, db, dc], ['c', 'b', 'a'], {
      fileListGrouping: 'folder'
    })
    const g = groupsForPresentation(s)
    expect(g.map((x) => x.key)).toEqual([UNGROUPED_FOLDER_KEY, '/p/y', '/p/x'])
    expect(g[0].ids).toEqual(['c'])
    expect(g[1].ids).toEqual(['b'])
    expect(g[2].ids).toEqual(['a'])
  })

  it('renders grouped labels relative to workspace root', () => {
    const s = stateWith([da, db], ['b', 'a'], {
      fileListGrouping: 'folder',
      workspaceFolderPath: '/p'
    })
    const g = groupsForPresentation(s)
    expect(g.map((x) => x.label)).toEqual(['y', 'x'])
  })
})

describe('isFolderExpanded', () => {
  it('respects expandedFolderGroups membership when grouping by folder', () => {
    const s = stateWith([], [], {
      fileListGrouping: 'folder',
      expandedFolderGroups: ['/tmp']
    })
    expect(isFolderExpanded(s, '/tmp')).toBe(true)
    expect(isFolderExpanded(s, '/other')).toBe(false)
  })

  it('treats all folders expanded when grouping is none', () => {
    const s = stateWith([], [], {
      fileListGrouping: 'none',
      expandedFolderGroups: []
    })
    expect(isFolderExpanded(s, '/anything')).toBe(true)
  })
})

describe('isEditorDirty', () => {
  it('compares buffer with persisted snapshot for current document', () => {
    const d = doc({ id: 'x', title: 'x', content: 'orig' })
    let s = stateWith([d], ['x'], { currentDocumentId: 'x', editorContent: 'orig' })
    expect(isEditorDirty(s)).toBe(false)
    const active = s.projectsById.get(s.activeProjectId)!
    const projectsById = new Map(s.projectsById)
    projectsById.set(s.activeProjectId, { ...active, editorContent: 'edited' })
    s = { ...s, projectsById, editorContent: 'edited' }
    expect(isEditorDirty(s)).toBe(true)
  })
})

describe('documentIdForAbsolutePath', () => {
  it('finds document by normalized absolute path', () => {
    const d = doc({ id: 'doc1', title: 'x', content: '', path: '/tmp/a.md' })
    const s = stateWith([d], ['doc1'])
    expect(documentIdForAbsolutePath(s, '/tmp/a.md')).toBe('doc1')
    expect(documentIdForAbsolutePath(s, '\\tmp\\a.md')).toBe('doc1')
  })
})

describe('REMOVE_FROM_RECENTS reducer edge cases', () => {
  const t0 = '2026-05-09T10:00:00.000Z'

  it('when removing current selection activates first remaining recent', () => {
    let s = createInitialAppState()
    s = reduceAppState(s, { type: 'OPEN_EXPLICIT', document: doc({ id: 'a', content: 'A' }) }, t0)
    s = reduceAppState(s, { type: 'OPEN_EXPLICIT', document: doc({ id: 'b', content: 'B' }) }, t0)
    s = reduceAppState(s, { type: 'ACTIVATE_FROM_RECENT_LIST', documentId: 'a' }, t0)
    s = reduceAppState(s, { type: 'REMOVE_FROM_RECENTS', documentId: 'a' }, t0)

    expect(s.recentDocumentIds).toEqual(['b'])
    expect(s.currentDocumentId).toBe('b')
    expect(s.editorContent).toBe('B')
  })

  it('when removing last remaining clears selection', () => {
    let s = createInitialAppState()
    s = reduceAppState(s, { type: 'OPEN_EXPLICIT', document: doc({ id: 'only', content: 'X' }) }, t0)
    s = reduceAppState(s, { type: 'REMOVE_FROM_RECENTS', documentId: 'only' }, t0)

    expect(s.recentDocumentIds).toEqual([])
    expect(s.currentDocumentId).toBe(null)
    expect(s.editorContent).toBe('')
  })
})
