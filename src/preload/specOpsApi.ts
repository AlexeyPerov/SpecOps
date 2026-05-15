import type {
  PreferencesPersistedV1,
  SessionPersistedV1
} from '../core/state/sessionCodec'
import type { SpecOpsMenuCommand } from '../ipc/specOpsIpc'

/** Typed surface exposed to the renderer via `contextBridge`. */
export type ReadMarkdownAssetPayload = Readonly<{
  docPath: string
  relativeUrl: string
}>

export type ReadMarkdownAssetResult =
  | Readonly<{ ok: true; base64: string; mimeType: string }>
  | Readonly<{ ok: false; reason: string }>

export type ReadTextFileResult =
  | Readonly<{ ok: true; content: string; mtimeIso: string | null }>
  | Readonly<{ ok: false; reason: string }>

export type CreateMarkdownResult =
  | Readonly<{ ok: true; absolutePath: string }>
  | Readonly<{ ok: false; reason: string }>

export type WriteTextFileResult =
  | Readonly<{ ok: true; mtimeIso: string }>
  | Readonly<{ ok: false; reason: string }>

export type PickOpenMarkdownFileResult =
  | Readonly<{ canceled: true }>
  | Readonly<{ canceled: false; filePath: string }>

export type PickSaveMarkdownFileResult =
  | Readonly<{ canceled: true }>
  | Readonly<{ canceled: false; filePath: string }>

export type DirtyNavigationChoice = 'save' | 'discard' | 'cancel'

export type RenamePathResult =
  | Readonly<{ ok: true; mtimeIso: string }>
  | Readonly<{ ok: false; reason: string }>

export type UnlinkPathResult = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>

export type ExternalFileChangedPayload = Readonly<{
  path: string
  content: string
  mtimeIso: string | null
}>

export type DraftRecoveryChoice = 'recover' | 'discard'

export type PersistedDraftPayload =
  | Readonly<{ version: 1; documentId: string; content: string; updatedAtIso: string }>
  | null

export type SpecOpsPreloadApi = Readonly<{
  ping: () => 'pong'
  getAppVersion: () => string
  getPlatform: () => NodeJS.Platform
  /** Absolute path joined from repository root (`out/main` → project root). */
  resolveRepoPath: (...segments: string[]) => Promise<string>
  readMarkdownAsset: (payload: ReadMarkdownAssetPayload) => Promise<ReadMarkdownAssetResult>
  pickWorkspaceFolder: () => Promise<string | null>
  getPathForFile: (file: File) => string | null
  revealInFolder: (filePath: string) => Promise<void>
  readTextFile: (absolutePath: string) => Promise<ReadTextFileResult>
  createMarkdownInWorkspace: (payload: {
    folderPath: string
    baseName: string
  }) => Promise<CreateMarkdownResult>
  listMarkdownFilesRecursive: (folderPath: string) => Promise<string[]>
  setWatchedDocPath: (absolutePath: string | null) => Promise<void>
  onExternalFileChanged: (callback: (payload: ExternalFileChangedPayload) => void) => () => void
  writeTextFile: (payload: {
    absolutePath: string
    content: string
  }) => Promise<WriteTextFileResult>
  pickOpenMarkdownFile: () => Promise<PickOpenMarkdownFileResult>
  pickSaveMarkdownFile: (payload?: {
    defaultPath?: string
  }) => Promise<PickSaveMarkdownFileResult>
  promptDirtyNavigation: () => Promise<DirtyNavigationChoice>
  confirmDeleteFile: (basename: string) => Promise<boolean>
  renamePathOnDisk: (payload: {
    fromPath: string
    toPath: string
  }) => Promise<RenamePathResult>
  unlinkFilePath: (absolutePath: string) => Promise<UnlinkPathResult>
  readPreferences: () => Promise<PreferencesPersistedV1>
  writePreferences: (prefs: PreferencesPersistedV1) => Promise<void>
  readSession: () => Promise<SessionPersistedV1 | null>
  writeSession: (session: SessionPersistedV1) => Promise<void>
  clearProjects: () => Promise<void>
  readDraft: (documentId: string) => Promise<PersistedDraftPayload>
  writeDraft: (payload: { documentId: string; content: string }) => Promise<void>
  clearDraft: (documentId: string) => Promise<void>
  listDraftIds: () => Promise<string[]>
  promptDraftRecovery: () => Promise<DraftRecoveryChoice>
  onMenuCommand: (callback: (commandId: SpecOpsMenuCommand) => void) => () => void
  /** Notify main window to reload preferences from disk (after settings window saves). */
  notifyPreferencesChanged: () => void
  onPreferencesChanged: (callback: () => void) => () => void
  onProjectsCleared: (callback: () => void) => () => void
}>
