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

export type ExternalFileChangedPayload = Readonly<{
  path: string
  content: string
  mtimeIso: string | null
}>

export type SpecOpsPreloadApi = Readonly<{
  ping: () => 'pong'
  getAppVersion: () => string
  getPlatform: () => NodeJS.Platform
  /** Absolute path joined from repository root (`out/main` → project root). */
  resolveRepoPath: (...segments: string[]) => Promise<string>
  readMarkdownAsset: (payload: ReadMarkdownAssetPayload) => Promise<ReadMarkdownAssetResult>
  pickWorkspaceFolder: () => Promise<string | null>
  revealInFolder: (filePath: string) => Promise<void>
  readTextFile: (absolutePath: string) => Promise<ReadTextFileResult>
  createMarkdownInWorkspace: (payload: {
    folderPath: string
    baseName: string
  }) => Promise<CreateMarkdownResult>
  setWatchedDocPath: (absolutePath: string | null) => Promise<void>
  onExternalFileChanged: (callback: (payload: ExternalFileChangedPayload) => void) => () => void
}>
