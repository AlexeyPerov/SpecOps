import { contextBridge, ipcRenderer } from 'electron'
import type { ReadMarkdownAssetPayload, SpecOpsPreloadApi } from './specOpsApi'

const api: SpecOpsPreloadApi = {
  ping: () => 'pong',
  getAppVersion: () => ipcRenderer.sendSync('specops:get-app-version') as string,
  getPlatform: () => ipcRenderer.sendSync('specops:get-platform') as NodeJS.Platform,
  resolveRepoPath: (...segments: string[]) =>
    ipcRenderer.invoke('specops:resolve-repo-path', segments) as Promise<string>,
  readMarkdownAsset: (payload: ReadMarkdownAssetPayload) =>
    ipcRenderer.invoke('specops:read-markdown-asset', payload)
}

contextBridge.exposeInMainWorld('specOps', api)
