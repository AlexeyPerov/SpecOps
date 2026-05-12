import type { App, IpcMain } from 'electron'

import { SPEC_OPS_IPC } from '../../ipc/specOpsIpc'

export function registerSystemHandlers(ipc: IpcMain, app: App): void {
  ipc.on(SPEC_OPS_IPC.getAppVersion, (event) => {
    event.returnValue = app.getVersion()
  })
  ipc.on(SPEC_OPS_IPC.getPlatform, (event) => {
    event.returnValue = process.platform
  })
}
