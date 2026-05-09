import { contextBridge, ipcRenderer } from 'electron'
import type { SpecOpsPreloadApi } from './specOpsApi'

const api: SpecOpsPreloadApi = {
  ping: () => 'pong',
  getAppVersion: () => ipcRenderer.sendSync('specops:get-app-version') as string,
  getPlatform: () => ipcRenderer.sendSync('specops:get-platform') as NodeJS.Platform
}

contextBridge.exposeInMainWorld('specOps', api)
