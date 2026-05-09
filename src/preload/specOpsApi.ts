/** Typed surface exposed to the renderer via `contextBridge`. */
export type ReadMarkdownAssetPayload = Readonly<{
  docPath: string
  relativeUrl: string
}>

export type ReadMarkdownAssetResult =
  | Readonly<{ ok: true; base64: string; mimeType: string }>
  | Readonly<{ ok: false; reason: string }>

export type SpecOpsPreloadApi = Readonly<{
  ping: () => 'pong'
  getAppVersion: () => string
  getPlatform: () => NodeJS.Platform
  /** Absolute path joined from repository root (`out/main` → project root). */
  resolveRepoPath: (...segments: string[]) => Promise<string>
  readMarkdownAsset: (payload: ReadMarkdownAssetPayload) => Promise<ReadMarkdownAssetResult>
}>
