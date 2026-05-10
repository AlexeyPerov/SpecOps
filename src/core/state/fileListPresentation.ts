import type { AppState } from './types'
import { UNGROUPED_FOLDER_KEY } from './types'

/** Parent directory key for grouping (renderer-safe, no Node path). */
export function folderKeyForDocumentPath(pathStr: string | null): string {
  if (!pathStr) return UNGROUPED_FOLDER_KEY
  const norm = pathStr.replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  if (idx <= 0) return UNGROUPED_FOLDER_KEY
  return norm.slice(0, idx)
}

export function orderedRecentIds(state: AppState): string[] {
  const ids = [...state.recentDocumentIds]
  if (state.fileListSort === 'lastOpened') return ids

  const docs = state.documentsById
  const sortKey = (id: string): string => {
    const d = docs.get(id)
    if (!d) return id
    if (state.fileListSort === 'title') return (d.title || id).toLowerCase()
    return (d.path ?? '\uffff').toLowerCase()
  }

  return [...ids].sort((a, b) => {
    const ka = sortKey(a)
    const kb = sortKey(b)
    if (ka < kb) return -1
    if (ka > kb) return 1
    return a.localeCompare(b)
  })
}

export interface RecentPresentationGroup {
  readonly key: string
  readonly label: string
  readonly ids: readonly string[]
}

export function groupsForPresentation(state: AppState): RecentPresentationGroup[] {
  const ordered = orderedRecentIds(state)
  if (state.fileListGrouping === 'none') {
    return [{ key: '_flat', label: '', ids: ordered }]
  }

  const bucket = new Map<string, string[]>()
  const groupOrder: string[] = []

  for (const id of ordered) {
    const doc = state.documentsById.get(id)
    const key = folderKeyForDocumentPath(doc?.path ?? null)
    if (!bucket.has(key)) {
      bucket.set(key, [])
      groupOrder.push(key)
    }
    bucket.get(key)!.push(id)
  }

  return groupOrder.map((key) => ({
    key,
    label: key === UNGROUPED_FOLDER_KEY ? 'Ungrouped' : key,
    ids: bucket.get(key) ?? []
  }))
}

export function isFolderExpanded(state: AppState, folderKey: string): boolean {
  if (state.fileListGrouping !== 'folder') return true
  return state.expandedFolderGroups.includes(folderKey)
}

export function isEditorDirty(state: AppState): boolean {
  if (state.currentDocumentId === null) return state.editorContent.length > 0
  const doc = state.documentsById.get(state.currentDocumentId)
  if (!doc) return false
  return doc.content !== state.editorContent
}

export function documentIdForAbsolutePath(state: AppState, absolutePath: string): string | undefined {
  const norm = absolutePath.replace(/\\/g, '/')
  for (const [id, doc] of state.documentsById) {
    const p = doc.path?.replace(/\\/g, '/')
    if (p === norm) return id
  }
  return undefined
}
