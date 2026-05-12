import type { BrowserWindow, Dialog, IpcMain } from 'electron'

import { SPEC_OPS_IPC } from '../../ipc/specOpsIpc'

export function registerDialogHandlers(
  ipc: IpcMain,
  deps: {
    BrowserWindow: typeof BrowserWindow
    dialog: Dialog
  }
): void {
  const { BrowserWindow, dialog } = deps

  ipc.handle(SPEC_OPS_IPC.dirtyNavigationPrompt, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return 'cancel' as const
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Unsaved changes',
      message: 'Save changes before continuing?',
      buttons: ['Save', 'Discard', 'Cancel'],
      defaultId: 0,
      cancelId: 2
    })
    if (response === 0) return 'save' as const
    if (response === 1) return 'discard' as const
    return 'cancel' as const
  })

  ipc.handle(SPEC_OPS_IPC.confirmDeleteFile, async (event, basename: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    if (!win) return false
    const name = typeof basename === 'string' && basename.trim() ? basename : 'this file'
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Delete file',
      message: `Delete "${name}" permanently?`,
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    })
    return response === 0
  })
}
