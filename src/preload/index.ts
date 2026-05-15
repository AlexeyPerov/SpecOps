import type { IpcRendererEvent } from 'electron'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { SPEC_OPS_IPC, type SpecOpsMenuCommand } from '../ipc/specOpsIpc'
import type {
  DirtyNavigationChoice,
  ExternalFileChangedPayload,
  PickOpenMarkdownFileResult,
  PickSaveMarkdownFileResult,
  ReadMarkdownAssetPayload,
  SpecOpsPreloadApi
} from './specOpsApi'

const api: SpecOpsPreloadApi = {
  ping: () => 'pong',
  getAppVersion: () => ipcRenderer.sendSync(SPEC_OPS_IPC.getAppVersion) as string,
  getPlatform: () => ipcRenderer.sendSync(SPEC_OPS_IPC.getPlatform) as NodeJS.Platform,
  resolveRepoPath: (...segments: string[]) =>
    ipcRenderer.invoke(SPEC_OPS_IPC.resolveRepoPath, segments) as Promise<string>,
  readMarkdownAsset: (payload: ReadMarkdownAssetPayload) =>
    ipcRenderer.invoke(SPEC_OPS_IPC.readMarkdownAsset, payload),
  pickWorkspaceFolder: () =>
    ipcRenderer.invoke(SPEC_OPS_IPC.pickWorkspaceFolder) as Promise<string | null>,
  getPathForFile: (file: File) => {
    try {
      const p = webUtils.getPathForFile(file)
      return p?.trim() ? p : null
    } catch {
      return null
    }
  },
  revealInFolder: (filePath: string) => ipcRenderer.invoke(SPEC_OPS_IPC.revealInFolder, filePath),
  readTextFile: (absolutePath: string) => ipcRenderer.invoke(SPEC_OPS_IPC.readTextFile, absolutePath),
  createMarkdownInWorkspace: (payload) =>
    ipcRenderer.invoke(SPEC_OPS_IPC.createMarkdownInWorkspace, payload),
  listMarkdownFilesRecursive: (folderPath) =>
    ipcRenderer.invoke(SPEC_OPS_IPC.listMarkdownFilesRecursive, folderPath),
  setWatchedDocPath: (absolutePath) =>
    ipcRenderer.invoke(SPEC_OPS_IPC.setWatchedDocPath, absolutePath),
  onExternalFileChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: ExternalFileChangedPayload) =>
      callback(payload)
    ipcRenderer.on(SPEC_OPS_IPC.externalFileChanged, listener)
    return () => ipcRenderer.removeListener(SPEC_OPS_IPC.externalFileChanged, listener)
  },
  writeTextFile: (payload) => ipcRenderer.invoke(SPEC_OPS_IPC.writeTextFile, payload),
  pickOpenMarkdownFile: () =>
    ipcRenderer.invoke(SPEC_OPS_IPC.pickOpenMarkdownFile) as Promise<PickOpenMarkdownFileResult>,
  pickSaveMarkdownFile: (payload) =>
    ipcRenderer.invoke(SPEC_OPS_IPC.pickSaveMarkdownFile, payload) as Promise<PickSaveMarkdownFileResult>,
  promptDirtyNavigation: () =>
    ipcRenderer.invoke(SPEC_OPS_IPC.dirtyNavigationPrompt) as Promise<DirtyNavigationChoice>,
  confirmDeleteFile: (basename) => ipcRenderer.invoke(SPEC_OPS_IPC.confirmDeleteFile, basename),
  renamePathOnDisk: (payload) => ipcRenderer.invoke(SPEC_OPS_IPC.renamePathOnDisk, payload),
  unlinkFilePath: (absolutePath) => ipcRenderer.invoke(SPEC_OPS_IPC.unlinkFilePath, absolutePath),
  readPreferences: () => ipcRenderer.invoke(SPEC_OPS_IPC.readPreferences),
  writePreferences: (prefs) => ipcRenderer.invoke(SPEC_OPS_IPC.writePreferences, prefs),
  readSession: () => ipcRenderer.invoke(SPEC_OPS_IPC.readSession),
  writeSession: (session) => ipcRenderer.invoke(SPEC_OPS_IPC.writeSession, session),
  clearProjects: () => ipcRenderer.invoke(SPEC_OPS_IPC.clearProjects),
  readDraft: (documentId) => ipcRenderer.invoke(SPEC_OPS_IPC.readDraft, documentId),
  writeDraft: (payload) => ipcRenderer.invoke(SPEC_OPS_IPC.writeDraft, payload),
  clearDraft: (documentId) => ipcRenderer.invoke(SPEC_OPS_IPC.clearDraft, documentId),
  listDraftIds: () => ipcRenderer.invoke(SPEC_OPS_IPC.listDraftIds),
  promptDraftRecovery: () => ipcRenderer.invoke(SPEC_OPS_IPC.promptDraftRecovery),
  onMenuCommand: (callback) => {
    const listener = (_event: IpcRendererEvent, commandId: unknown) =>
      callback(String(commandId ?? '') as SpecOpsMenuCommand)
    ipcRenderer.on(SPEC_OPS_IPC.menuCommand, listener)
    return () => ipcRenderer.removeListener(SPEC_OPS_IPC.menuCommand, listener)
  },
  notifyPreferencesChanged: () => {
    ipcRenderer.send(SPEC_OPS_IPC.notifyPreferencesChanged)
  },
  onPreferencesChanged: (callback) => {
    const listener = (_event: IpcRendererEvent) => callback()
    ipcRenderer.on(SPEC_OPS_IPC.preferencesChangedMain, listener)
    return () => ipcRenderer.removeListener(SPEC_OPS_IPC.preferencesChangedMain, listener)
  },
  onProjectsCleared: (callback) => {
    const listener = (_event: IpcRendererEvent) => callback()
    ipcRenderer.on(SPEC_OPS_IPC.projectsClearedMain, listener)
    return () => ipcRenderer.removeListener(SPEC_OPS_IPC.projectsClearedMain, listener)
  }
}

contextBridge.exposeInMainWorld('specOps', api)
