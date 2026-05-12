import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'

import { SPEC_OPS_IPC } from '../ipc/specOpsIpc'
import { registerDialogHandlers } from './ipc/registerDialogHandlers'
import { registerFileHandlers } from './ipc/registerFileHandlers'
import { registerPreviewHandlers } from './ipc/registerPreviewHandlers'
import { registerSystemHandlers } from './ipc/registerSystemHandlers'
import { registerWatcherHandlers } from './ipc/registerWatcherHandlers'
import { registerWorkspaceHandlers } from './ipc/registerWorkspaceHandlers'
import { createApplicationMenu } from './menu'
import { registerPersistenceIpc } from './persistence'
import { createSaveQueue } from './saveSerialize'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Project root when bundled under `<root>/out/main`. */
function repoRoot(): string {
  return join(__dirname, '..', '..')
}

process.env.APP_ROOT = repoRoot()

const saveQueue = createSaveQueue()

function registerSpecOpsHandlers(): void {
  registerSystemHandlers(ipcMain, app)
  ipcMain.handle(SPEC_OPS_IPC.resolveRepoPath, (_evt, segments: string[]) => {
    return join(repoRoot(), ...segments)
  })
  registerPreviewHandlers(ipcMain)
  registerWorkspaceHandlers(ipcMain, { BrowserWindow, dialog, shell })
  const watcherDeps = registerWatcherHandlers(ipcMain)
  registerFileHandlers(ipcMain, {
    BrowserWindow,
    dialog,
    saveQueue,
    syncWatchSlotMtimeAfterOwnWrite: watcherDeps.syncWatchSlotMtimeAfterOwnWrite
  })
  registerDialogHandlers(ipcMain, { BrowserWindow, dialog })
}

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const preload = join(__dirname, '../preload/index.cjs')

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null

function showSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }
  const win = new BrowserWindow({
    width: 480,
    height: 300,
    title: 'Settings',
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  settingsWindow = win
  win.on('closed', () => {
    settingsWindow = null
  })
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[specops] Settings preload failed (${preloadPath}):`, error)
  })
  if (VITE_DEV_SERVER_URL) {
    const base = VITE_DEV_SERVER_URL.replace(/\/$/, '')
    void win.loadURL(`${base}/settings.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/settings.html'))
  }
  win.once('ready-to-show', () => win.show())
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1580,
    height: 1061,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow = win
  win.on('closed', () => {
    mainWindow = null
  })

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[specops] Preload script failed (${preloadPath}):`, error)
  })

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(async () => {
  if (!existsSync(preload)) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'SpecOps failed to start',
      message:
        `The preload script was not built or is missing at:\n\n${preload}\n\nRebuild with \`npm run build\`, or stop any --renderer-only dev server without opening the page outside Electron.`,
      buttons: ['OK']
    })
    app.quit()
    return
  }
  registerSpecOpsHandlers()
  registerPersistenceIpc(app)

  ipcMain.on(SPEC_OPS_IPC.notifyPreferencesChanged, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(SPEC_OPS_IPC.preferencesChangedMain)
  })

  Menu.setApplicationMenu(
    createApplicationMenu(app, {
      openSettings: showSettingsWindow
    })
  )
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
