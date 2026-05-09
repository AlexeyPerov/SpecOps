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

export interface AppState {
  readonly documentsById: Map<string, Document>
  readonly recentDocumentIds: string[]
  readonly currentDocumentId: string | null
  readonly editorContent: string
  readonly themeMode: ThemeMode
}

/** Upsert payload for explicit opens; `lastOpened` is always overwritten by the transition. */
export type DocumentInput = Omit<Document, 'lastOpened'> & {
  readonly lastOpened?: string
}

export type AppAction =
  | { readonly type: 'OPEN_EXPLICIT'; readonly document: DocumentInput }
  | { readonly type: 'ACTIVATE_FROM_RECENT_LIST'; readonly documentId: string }
  | { readonly type: 'EDITOR_CHANGE'; readonly content: string }
  | { readonly type: 'SET_THEME_MODE'; readonly mode: ThemeMode }
