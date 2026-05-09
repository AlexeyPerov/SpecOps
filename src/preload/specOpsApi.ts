/** Typed surface exposed to the renderer via `contextBridge`. */
export type SpecOpsPreloadApi = Readonly<{
  ping: () => 'pong'
  getAppVersion: () => string
  getPlatform: () => NodeJS.Platform
}>
