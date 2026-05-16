export const SPEC_OPS_IPC = {
  getAppVersion: 'specops:get-app-version',
  getPlatform: 'specops:get-platform',
  resolveRepoPath: 'specops:resolve-repo-path',
  readMarkdownAsset: 'specops:read-markdown-asset',
  pickWorkspaceFolder: 'specops:pick-workspace-folder',
  revealInFolder: 'specops:reveal-in-folder',
  readTextFile: 'specops:read-text-file',
  createMarkdownInWorkspace: 'specops:create-markdown-in-workspace',
  listMarkdownFilesRecursive: 'specops:list-markdown-files-recursive',
  setWatchedDocPath: 'specops:set-watched-doc-path',
  externalFileChanged: 'specops:external-file-changed',
  writeTextFile: 'specops:write-text-file',
  pickOpenFile: 'specops:pick-open-file',
  pickSaveFile: 'specops:pick-save-file',
  dirtyNavigationPrompt: 'specops:dirty-navigation-prompt',
  confirmDeleteFile: 'specops:confirm-delete-file',
  renamePathOnDisk: 'specops:rename-path-on-disk',
  unlinkFilePath: 'specops:unlink-file-path',
  readPreferences: 'specops:read-preferences',
  writePreferences: 'specops:write-preferences',
  readSession: 'specops:read-session',
  writeSession: 'specops:write-session',
  clearProjects: 'specops:clear-projects',
  readDraft: 'specops:read-draft',
  writeDraft: 'specops:write-draft',
  clearDraft: 'specops:clear-draft',
  listDraftIds: 'specops:list-draft-ids',
  promptDraftRecovery: 'specops:prompt-draft-recovery',
  menuCommand: 'specops:menu-command',
  notifyPreferencesChanged: 'specops:notify-preferences-changed',
  preferencesChangedMain: 'specops:preferences-changed-main',
  projectsClearedMain: 'specops:projects-cleared-main'
} as const

export const SPEC_OPS_MENU_COMMANDS = {
  openFile: 'open-file',
  newUntitled: 'new-untitled',
  save: 'save',
  saveAs: 'save-as',
  miscWorkspaceFolder: 'misc-workspace-folder',
  miscNewMarkdown: 'misc-new-markdown',
  miscSeedDemos: 'misc-seed-demos',
  miscOpenFixture: 'misc-open-fixture',
  find: 'find',
  findReplace: 'find-replace'
} as const

export type SpecOpsMenuCommand =
  (typeof SPEC_OPS_MENU_COMMANDS)[keyof typeof SPEC_OPS_MENU_COMMANDS]

export type ReadMarkdownAssetPayload = Readonly<{
  docPath: string
  relativeUrl: string
}>

export type ReadMarkdownAssetResult =
  | Readonly<{ ok: true; base64: string; mimeType: string }>
  | Readonly<{ ok: false; reason: string }>

export type CreateMarkdownInWorkspacePayload = Readonly<{
  folderPath: unknown
  baseName: unknown
}>

export type CreateMarkdownInWorkspaceResult =
  | Readonly<{ ok: true; absolutePath: string }>
  | Readonly<{ ok: false; reason: string }>

export type ReadTextFileFailureReason =
  | 'invalid_path'
  | 'read_error'
  | 'unreadable'
  | 'binary'
  | 'too_large'

export type ReadTextFileResult =
  | Readonly<{ ok: true; content: string; mtimeIso: string | null }>
  | Readonly<{ ok: false; reason: ReadTextFileFailureReason }>

export type WriteTextFilePayload = Readonly<{
  absolutePath: unknown
  content: unknown
}>

export type WriteTextFileResult =
  | Readonly<{ ok: true; mtimeIso: string }>
  | Readonly<{ ok: false; reason: string }>

export type PickOpenFileResult =
  | Readonly<{ canceled: true }>
  | Readonly<{ canceled: false; filePath: string }>

export type PickSaveFilePayload = Readonly<{
  defaultPath?: string
}>

export type PickSaveFileResult =
  | Readonly<{ canceled: true }>
  | Readonly<{ canceled: false; filePath: string }>

export type DirtyNavigationChoice = 'save' | 'discard' | 'cancel'

export type RenamePathOnDiskPayload = Readonly<{
  fromPath: unknown
  toPath: unknown
}>

export type RenamePathOnDiskResult =
  | Readonly<{ ok: true; mtimeIso: string }>
  | Readonly<{ ok: false; reason: string }>

export type UnlinkPathResult = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>

export type ExternalFileChangedPayload = Readonly<{
  path: string
  content: string
  mtimeIso: string | null
}>
