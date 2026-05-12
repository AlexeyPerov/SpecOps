/** Canonical document record (Architecture §4.2 + UI path fields). */

export interface Document {
  readonly id: string
  readonly title: string
  readonly content: string
  /** ISO-8601 datetime string */
  readonly lastOpened: string
  readonly path: string | null
  /** ISO-8601 datetime string or null when unknown */
  readonly lastModified: string | null
}

export type ThemeMode = 'light' | 'dark' | 'system'

export type FileListSort = 'lastOpened' | 'title' | 'path'

export type FileListGrouping = 'none' | 'folder'

export const UNGROUPED_FOLDER_KEY = '__ungrouped__'

export interface ProjectState {
  readonly documentsById: Map<string, Document>
  readonly recentDocumentIds: string[]
  readonly currentDocumentId: string | null
  readonly editorContent: string
  /** Single workspace root for Task 12 MVP create-file flow */
  readonly workspaceFolderPath: string | null
  readonly fileListSort: FileListSort
  readonly fileListGrouping: FileListGrouping
  /** When grouping by folder, folder keys listed here are expanded in the recents list. */
  readonly expandedFolderGroups: readonly string[]
}

export interface AppState {
  readonly projectsById: Map<string, ProjectState>
  readonly activeProjectId: string
  readonly themeMode: ThemeMode
  /** DEF-06 default false */
  readonly autosaveEnabled: boolean
  /** DEF-07 default true */
  readonly editorSoftWrap: boolean
  /** DEF-08 default true */
  readonly editorLineNumbers: boolean
  /** Recents sidebar width in pixels (persisted in preferences). */
  readonly recentsPaneWidthPx: number
  /**
   * Transitional mirrors of active project fields used by pre-Task-6 callers.
   * Keep in sync with `projectsById.get(activeProjectId)`.
   */
  readonly documentsById: Map<string, Document>
  readonly recentDocumentIds: string[]
  readonly currentDocumentId: string | null
  readonly editorContent: string
  readonly workspaceFolderPath: string | null
  readonly fileListSort: FileListSort
  readonly fileListGrouping: FileListGrouping
  readonly expandedFolderGroups: readonly string[]
}

/** Upsert payload for explicit opens; `lastOpened` is always overwritten by the transition. */
export type DocumentInput = Omit<Document, 'lastOpened'> & {
  readonly lastOpened?: string
}

export type AppAction =
  | {
      readonly type: 'CREATE_PROJECT'
      readonly projectId: string
      readonly workspaceFolderPath?: string | null
    }
  | { readonly type: 'SET_ACTIVE_PROJECT'; readonly projectId: string }
  | { readonly type: 'REMOVE_PROJECT'; readonly projectId: string }
  | { readonly type: 'OPEN_EXPLICIT'; readonly document: DocumentInput }
  | { readonly type: 'ACTIVATE_FROM_RECENT_LIST'; readonly documentId: string }
  | { readonly type: 'EDITOR_CHANGE'; readonly content: string }
  | { readonly type: 'SET_THEME_MODE'; readonly mode: ThemeMode }
  | { readonly type: 'SET_FILE_LIST_SORT'; readonly sort: FileListSort }
  | { readonly type: 'SET_FILE_LIST_GROUPING'; readonly grouping: FileListGrouping }
  | { readonly type: 'TOGGLE_FOLDER_EXPANDED'; readonly folderKey: string }
  | { readonly type: 'REMOVE_FROM_RECENTS'; readonly documentId: string }
  | {
      readonly type: 'SYNC_DOCUMENT_FROM_DISK'
      readonly documentId: string
      readonly content: string
      readonly lastModified: string | null
    }
  | { readonly type: 'SET_WORKSPACE_FOLDER'; readonly path: string | null }
  | {
      readonly type: 'REPARENT_DOCUMENT'
      readonly oldDocumentId: string
      readonly newAbsolutePath: string
      readonly content: string
      readonly lastModified: string | null
    }
  | { readonly type: 'DROP_DOCUMENT'; readonly documentId: string }
  | { readonly type: 'SET_AUTOSAVE_ENABLED'; readonly enabled: boolean }
  | { readonly type: 'SET_EDITOR_SOFT_WRAP'; readonly enabled: boolean }
  | { readonly type: 'SET_EDITOR_LINE_NUMBERS'; readonly enabled: boolean }
  | { readonly type: 'SET_RECENTS_PANE_WIDTH'; readonly widthPx: number }
