import type { AppState } from './types'
import { UNGROUPED_FOLDER_KEY } from './types'
import { selectActiveProject } from './selectors'

/** Parent directory key for grouping (renderer-safe, no Node path). */
export function folderKeyForDocumentPath(pathStr: string | null): string {
  if (!pathStr) return UNGROUPED_FOLDER_KEY
  const norm = pathStr.replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  if (idx <= 0) return UNGROUPED_FOLDER_KEY
  return norm.slice(0, idx)
}

export function orderedRecentIds(state: AppState): string[] {
  const project = selectActiveProject(state)
  const ids = [...project.recentDocumentIds]
  if (project.fileListSort === 'lastOpened') return ids

  const docs = project.documentsById
  const sortKey = (id: string): string => {
    const d = docs.get(id)
    if (!d) return id
    if (project.fileListSort === 'title') return (d.title || id).toLowerCase()
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

function folderLabelForSidebar(workspaceFolderPath: string | null, folderKey: string): string {
  if (folderKey === UNGROUPED_FOLDER_KEY) return 'Ungrouped'
  const root = workspaceFolderPath?.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!root) return folderKey
  const keyNorm = folderKey.replace(/\\/g, '/')
  if (keyNorm === root) return '.'
  const prefix = `${root}/`
  if (keyNorm.startsWith(prefix)) {
    const rel = keyNorm.slice(prefix.length)
    return rel || '.'
  }
  return folderKey
}

export function groupsForPresentation(state: AppState): RecentPresentationGroup[] {
  const project = selectActiveProject(state)
  const ordered = orderedRecentIds(state)
  if (project.fileListGrouping === 'none') {
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

  const workspaceRoot = project.workspaceFolderPath

  return groupOrder.map((key) => ({
    key,
    label: folderLabelForSidebar(workspaceRoot, key),
    ids: bucket.get(key) ?? []
  }))
}

export function isFolderExpanded(state: AppState, folderKey: string): boolean {
  const project = selectActiveProject(state)
  if (project.fileListGrouping !== 'folder') return true
  return project.expandedFolderGroups.includes(folderKey)
}

export function isEditorDirty(state: AppState): boolean {
  const project = selectActiveProject(state)
  if (project.currentDocumentId === null) return project.editorContent.length > 0
  const doc = project.documentsById.get(project.currentDocumentId)
  if (!doc) return false
  return doc.content !== project.editorContent
}

export function documentIdForAbsolutePath(state: AppState, absolutePath: string): string | undefined {
  const project = selectActiveProject(state)
  const norm = absolutePath.replace(/\\/g, '/')
  for (const [id, doc] of project.documentsById) {
    const p = doc.path?.replace(/\\/g, '/')
    if (p === norm) return id
  }
  return undefined
}
