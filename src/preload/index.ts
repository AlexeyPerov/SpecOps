import type { IpcRendererEvent } from 'electron'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  ExternalFileChangedPayload,
  ReadMarkdownAssetPayload,
  SpecOpsPreloadApi
} from './specOpsApi'

const api: SpecOpsPreloadApi = {
  ping: () => 'pong',
  getAppVersion: () => ipcRenderer.sendSync('specops:get-app-version') as string,
  getPlatform: () => ipcRenderer.sendSync('specops:get-platform') as NodeJS.Platform,
  resolveRepoPath: (...segments: string[]) =>
    ipcRenderer.invoke('specops:resolve-repo-path', segments) as Promise<string>,
  readMarkdownAsset: (payload: ReadMarkdownAssetPayload) =>
    ipcRenderer.invoke('specops:read-markdown-asset', payload),
  pickWorkspaceFolder: () =>
    ipcRenderer.invoke('specops:pick-workspace-folder') as Promise<string | null>,
  revealInFolder: (filePath: string) => ipcRenderer.invoke('specops:reveal-in-folder', filePath),
  readTextFile: (absolutePath: string) => ipcRenderer.invoke('specops:read-text-file', absolutePath),
  createMarkdownInWorkspace: (payload) =>
    ipcRenderer.invoke('specops:create-markdown-in-workspace', payload),
  setWatchedDocPath: (absolutePath) =>
    ipcRenderer.invoke('specops:set-watched-doc-path', absolutePath),
  onExternalFileChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: ExternalFileChangedPayload) =>
      callback(payload)
    ipcRenderer.on('specops:external-file-changed', listener)
    return () => ipcRenderer.removeListener('specops:external-file-changed', listener)
  }
}

contextBridge.exposeInMainWorld('specOps', api)
