import { describe, expect, it, vi } from 'vitest'

import { chatStateFromPersisted } from '../chat/chatState'
import {
  DEFAULT_PREFERENCES_V1,
  isRecoverableDraft,
  mergePreferencesIntoState,
  mergeSessionIntoState,
  refreshSessionDocumentsFromDisk,
  serializePreferencesFromState,
  serializeSessionFromState
} from './sessionCodec'
import { createInitialAppState, reduceAppState } from './transitions'

describe('sessionCodec (TEST-10 helpers)', () => {
  it('mergePreferencesIntoState applies persisted prefs', () => {
    const base = createInitialAppState()
    const next = mergePreferencesIntoState(base, {
      ...DEFAULT_PREFERENCES_V1,
      autosaveEnabled: true,
      editorSoftWrap: false,
      editorLineNumbers: false
    })
    expect(next.autosaveEnabled).toBe(true)
    expect(next.editorSoftWrap).toBe(false)
    expect(next.editorLineNumbers).toBe(false)
    expect(next.fileListGrouping).toBe('folder')
  })

  it('isRecoverableDraft detects differing draft', () => {
    expect(isRecoverableDraft('saved', 'draft')).toBe(true)
    expect(isRecoverableDraft('same', 'same')).toBe(false)
    expect(isRecoverableDraft('x', undefined)).toBe(false)
  })

  it('serializeSessionFromState keeps document.content baseline not live editor buffer', () => {
    const doc = {
      id: 'x',
      title: 't',
      content: 'baseline',
      lastOpened: '2026-01-01T00:00:00.000Z',
      path: '/virtual/p.md',
      lastModified: null as string | null
    }
    let s = createInitialAppState()
    const active = s.projectsById.get(s.activeProjectId)!
    const projectsById = new Map(s.projectsById)
    projectsById.set(s.activeProjectId, {
      ...active,
      documentsById: new Map([[doc.id, doc]]),
      recentDocumentIds: [doc.id],
      currentDocumentId: doc.id,
      editorContent: doc.content
    })
    s = reduceAppState(
      {
        ...s,
        projectsById,
        documentsById: new Map([[doc.id, doc]]),
        recentDocumentIds: [doc.id],
        currentDocumentId: doc.id,
        editorContent: doc.content
      },
      { type: 'EDITOR_CHANGE', content: 'dirty-typing' },
      '2026-01-01T00:00:00.000Z'
    )
    const snap = serializeSessionFromState(s)
    expect(snap.projects[0]?.documents[0]?.content).toBe('baseline')
  })

  it('serializePreferencesFromState includes editor preference flags', () => {
    const s = {
      ...createInitialAppState(),
      autosaveEnabled: true,
      editorSoftWrap: false,
      editorLineNumbers: true,
      themeMode: 'dark' as const
    }
    const p = serializePreferencesFromState(s)
    expect(p.autosaveEnabled).toBe(true)
    expect(p.editorSoftWrap).toBe(false)
    expect(p.themeMode).toBe('dark')
  })

  it('mergePreferencesIntoState applies sanitized markdown scan folders', () => {
    const base = createInitialAppState()
    const next = mergePreferencesIntoState(base, {
      ...DEFAULT_PREFERENCES_V1,
      markdownScanRelativeFolders: ['specs', ' specs ', '../bad']
    })
    expect(next.markdownScanRelativeFolders).toEqual(['specs'])
  })

  it('serializePreferencesFromState preserves markdownScanRelativeFolders round-trip', () => {
    let s = createInitialAppState()
    s = reduceAppState(
      s,
      { type: 'SET_MARKDOWN_SCAN_RELATIVE_FOLDERS', folders: ['specs', 'docs'] },
      '2026-01-01T00:00:00.000Z'
    )
    const blob = serializePreferencesFromState(s)
    expect(blob.markdownScanRelativeFolders).toEqual(['specs', 'docs'])
    const merged = mergePreferencesIntoState(createInitialAppState(), blob)
    expect(merged.markdownScanRelativeFolders).toEqual(['specs', 'docs'])
  })

  it('mergeSessionIntoState restores documents and editor baseline', () => {
    const base = mergePreferencesIntoState(createInitialAppState(), DEFAULT_PREFERENCES_V1)
    const merged = mergeSessionIntoState(base, {
      version: 2,
      activeProjectId: 'default',
      projects: [
        {
          projectId: 'default',
          workspaceFolderPath: null,
          fileListSort: 'lastOpened',
          fileListGrouping: 'none',
          expandedFolderGroups: [],
          recentDocumentIds: ['a'],
          currentDocumentId: 'a',
          documents: [
            {
              id: 'a',
              title: 'Note',
              path: null,
              lastModified: null,
              lastOpened: '2026-01-01T00:00:00.000Z',
              content: 'hello'
            }
          ]
        }
      ]
    })
    expect(merged.currentDocumentId).toBe('a')
    expect(merged.editorContent).toBe('hello')
    expect(merged.documentsById.get('a')?.content).toBe('hello')
    expect(merged.projectsById.get(merged.activeProjectId)?.currentDocumentId).toBe('a')
    expect(merged.projectsById.get('default')?.chat.threadsById.size).toBe(0)
  })

  it('serializeSessionFromState round-trip preserves empty project chat state', () => {
    const s = createInitialAppState()
    const blob = serializeSessionFromState(s)
    const merged = mergeSessionIntoState(createInitialAppState(), blob)
    const proj = merged.projectsById.get(merged.activeProjectId)!
    expect(proj.chat.threadsById.size).toBe(0)
    expect(proj.chat.messagesByThreadId.size).toBe(0)
    expect(proj.chat.activeThreadId).toBeNull()
  })

  it('serializeSessionFromState round-trip preserves synthetic chat', () => {
    const synth = chatStateFromPersisted({
      threads: [{ id: 't1', title: 'T', createdAtIso: '2026-01-01T00:00:00.000Z' }],
      activeThreadId: 't1',
      messagesByThread: [
        {
          threadId: 't1',
          messages: [
            { id: 'm1', role: 'user', body: 'hi', createdAtIso: '2026-01-02T00:00:00.000Z' }
          ]
        }
      ]
    })
    let s = createInitialAppState()
    const activeId = s.activeProjectId
    const active = s.projectsById.get(activeId)!
    const projectsById = new Map(s.projectsById)
    projectsById.set(activeId, { ...active, chat: synth })
    s = { ...s, projectsById }
    const blob = serializeSessionFromState(s)
    const merged = mergeSessionIntoState(createInitialAppState(), blob)
    const chat = merged.projectsById.get(activeId)!.chat
    expect(chat.activeThreadId).toBe('t1')
    expect(chat.threadsById.get('t1')?.title).toBe('T')
    expect(chat.messagesByThreadId.get('t1')?.[0]?.body).toBe('hi')
  })

  it('refreshSessionDocumentsFromDisk skips missing files', async () => {
    const read = vi.fn(async (p: string) =>
      p === '/ok.md'
        ? ({ ok: true as const, content: 'from-disk', mtimeIso: '2026-01-02T00:00:00.000Z' })
        : ({ ok: false as const, reason: 'enoent' })
    )
    const out = await refreshSessionDocumentsFromDisk(
      [
        {
          id: '1',
          title: 'gone',
          path: '/missing.md',
          lastModified: null,
          lastOpened: 't',
          content: 'session'
        },
        {
          id: '2',
          title: 'ok',
          path: '/ok.md',
          lastModified: null,
          lastOpened: 't',
          content: 'old'
        }
      ],
      read
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe('2')
    expect(out[0]?.content).toBe('from-disk')
  })
})
