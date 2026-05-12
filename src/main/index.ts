import { existsSync, watch } from 'node:fs'
import { promises as fs } from 'node:fs'
import {
  dirname,
  join,
  relative,
  normalize,
  resolve,
  isAbsolute
} from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'

import { SPEC_OPS_IPC } from '../ipc/specOpsIpc'
import { createApplicationMenu } from './menu'
import { registerPersistenceIpc } from './persistence'
import { createSaveQueue } from './saveSerialize'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Project root when bundled under `<root>/out/main`. */
function repoRoot(): string {
  return join(__dirname, '..', '..')
}

process.env.APP_ROOT = repoRoot()

function guessMime(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}

function isPathContained(parentResolved: string, childResolved: string): boolean {
  const rel = relative(parentResolved, childResolved)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function safeMarkdownBasename(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s) return null
  s = s.replace(/[/\\]/g, '')
  if (s.includes('..')) return null
  if (!s.toLowerCase().endsWith('.md')) s += '.md'
  if (!/^[\w.\- ]+\.md$/i.test(s)) return null
  return s
}

type WatchSlot = {
  absolutePath: string | null
  watcher: ReturnType<typeof watch> | null
  debounceTimer: ReturnType<typeof setTimeout> | null
  /** Latest mtime we have already reflected to the renderer (or just established as baseline). */
  lastSeenMtimeMs: number | null
}

const watchSlots = new Map<number, WatchSlot>()

function watchSlotFor(senderId: number): WatchSlot {
  let slot = watchSlots.get(senderId)
  if (!slot) {
    slot = { absolutePath: null, watcher: null, debounceTimer: null, lastSeenMtimeMs: null }
    watchSlots.set(senderId, slot)
  }
  return slot
}

function assertAbsoluteNormalizedPath(p: string): string | null {
  try {
    const r = normalize(resolve(p.trim()))
    if (!isAbsolute(r)) return null
    return r
  } catch {
    return null
  }
}

const saveQueue = createSaveQueue()

function syncWatchSlotMtimeAfterOwnWrite(senderId: number, normalizedAbsolutePath: string, mtimeMs: number): void {
  const slot = watchSlots.get(senderId)
  if (!slot?.absolutePath) return
  if (normalize(slot.absolutePath) !== normalize(normalizedAbsolutePath)) return
  slot.lastSeenMtimeMs = mtimeMs
}

function stopDocWatcher(slot: WatchSlot): void {
  if (slot.debounceTimer) {
    clearTimeout(slot.debounceTimer)
    slot.debounceTimer = null
  }
  if (slot.watcher) {
    slot.watcher.close()
    slot.watcher = null
  }
  slot.absolutePath = null
  slot.lastSeenMtimeMs = null
}

function registerSpecOpsHandlers(): void {
  ipcMain.on(SPEC_OPS_IPC.getAppVersion, (event) => {
    event.returnValue = app.getVersion()
  })
  ipcMain.on(SPEC_OPS_IPC.getPlatform, (event) => {
    event.returnValue = process.platform
  })

  ipcMain.handle(SPEC_OPS_IPC.resolveRepoPath, (_evt, segments: string[]) => {
    return join(repoRoot(), ...segments)
  })

  ipcMain.handle(
    SPEC_OPS_IPC.readMarkdownAsset,
    async (_evt, payload: { docPath: string; relativeUrl: string }) => {
      try {
        const { docPath, relativeUrl } = payload
        const docDir = dirname(docPath)
        let target = relativeUrl.trim()
        try {
          target = decodeURIComponent(target)
        } catch {
          /* keep raw */
        }
        target = target.replace(/^[/\\]+/, '')
        const candidate = normalize(join(docDir, target))
        const rel = relative(docDir, candidate)
        if (rel.startsWith('..') || rel === '') {
          return { ok: false as const, reason: 'path_escape' }
        }
        const stat = await fs.stat(candidate)
        if (!stat.isFile()) return { ok: false as const, reason: 'not_file' }
        const buf = await fs.readFile(candidate)
        return {
          ok: true as const,
          base64: buf.toString('base64'),
          mimeType: guessMime(candidate)
        }
      } catch {
        return { ok: false as const, reason: 'read_error' }
      }
    }
  )

  ipcMain.handle(SPEC_OPS_IPC.pickWorkspaceFolder, async (event) => {
    const win =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
    const res = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    return res.filePaths[0]
  })

  ipcMain.handle(SPEC_OPS_IPC.revealInFolder, async (_evt, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath.trim()) return
    shell.showItemInFolder(normalize(filePath))
  })

  ipcMain.handle(SPEC_OPS_IPC.readTextFile, async (_evt, absolutePath: unknown) => {
    try {
      if (typeof absolutePath !== 'string' || !absolutePath.trim()) {
        return { ok: false as const, reason: 'invalid_path' }
      }
      const target = normalize(absolutePath)
      const content = await fs.readFile(target, 'utf8')
      const stat = await fs.stat(target)
      return {
        ok: true as const,
        content,
        mtimeIso: stat.mtime.toISOString()
      }
    } catch {
      return { ok: false as const, reason: 'read_error' }
    }
  })

  ipcMain.handle(
    SPEC_OPS_IPC.createMarkdownInWorkspace,
    async (_evt, payload: { folderPath: unknown; baseName: unknown }) => {
      const folderPath = payload?.folderPath
      if (typeof folderPath !== 'string' || !folderPath.trim()) {
        return { ok: false as const, reason: 'invalid_folder' }
      }
      const safeName = safeMarkdownBasename(payload.baseName)
      if (!safeName) return { ok: false as const, reason: 'invalid_name' }

      const rootDir = resolve(folderPath)
      const absolutePath = normalize(join(rootDir, safeName))
      if (!isPathContained(rootDir, absolutePath)) {
        return { ok: false as const, reason: 'path_escape' }
      }

      try {
        await fs.mkdir(dirname(absolutePath), { recursive: true })
        await fs.writeFile(absolutePath, '# New file\n', 'utf8')
        return { ok: true as const, absolutePath }
      } catch {
        return { ok: false as const, reason: 'write_error' }
      }
    }
  )

  ipcMain.handle(SPEC_OPS_IPC.setWatchedDocPath, async (event, filePath: unknown) => {
    const slot = watchSlotFor(event.sender.id)
    stopDocWatcher(slot)
    if (typeof filePath !== 'string' || !filePath.trim()) return

    const normalized = normalize(filePath)
    slot.absolutePath = normalized
    try {
      const st = await fs.stat(normalized)
      slot.lastSeenMtimeMs = st.mtimeMs
    } catch {
      slot.lastSeenMtimeMs = null
    }

    try {
      slot.watcher = watch(normalized, () => {
        if (slot.debounceTimer) clearTimeout(slot.debounceTimer)
        slot.debounceTimer = setTimeout(() => {
          void (async () => {
            const target = slot.absolutePath
            if (!target) return
            try {
              const stat = await fs.stat(target)
              if (slot.lastSeenMtimeMs !== null && stat.mtimeMs === slot.lastSeenMtimeMs) {
                return
              }
              const content = await fs.readFile(target, 'utf8')
              slot.lastSeenMtimeMs = stat.mtimeMs
              event.sender.send(SPEC_OPS_IPC.externalFileChanged, {
                path: target,
                content,
                mtimeIso: stat.mtime.toISOString()
              })
            } catch {
              /* ignore */
            }
          })()
        }, 150)
      })
    } catch {
      /* ignore */
    }
  })

  ipcMain.handle(
    SPEC_OPS_IPC.writeTextFile,
    async (event, payload: { absolutePath: unknown; content: unknown }) => {
      const wcId = event.sender.id
      return saveQueue.enqueue(wcId, async () => {
        const target = assertAbsoluteNormalizedPath(String(payload?.absolutePath ?? ''))
        const content = typeof payload?.content === 'string' ? payload.content : null
        if (!target || content === null) {
          return { ok: false as const, reason: 'invalid_payload' }
        }
        try {
          await fs.mkdir(dirname(target), { recursive: true })
          await fs.writeFile(target, content, 'utf8')
          const stat = await fs.stat(target)
          syncWatchSlotMtimeAfterOwnWrite(wcId, target, stat.mtimeMs)
          return { ok: true as const, mtimeIso: stat.mtime.toISOString() }
        } catch {
          return { ok: false as const, reason: 'write_error' }
        }
      })
    }
  )

  ipcMain.handle(SPEC_OPS_IPC.pickOpenMarkdownFile, async (event) => {
    const win =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    })
    if (res.canceled || !res.filePaths[0]) return { canceled: true as const }
    return { canceled: false as const, filePath: normalize(res.filePaths[0]) }
  })

  ipcMain.handle(
    SPEC_OPS_IPC.pickSaveMarkdownFile,
    async (event, payload?: { defaultPath?: string }) => {
      const win =
        BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
      const res = await dialog.showSaveDialog(win, {
        defaultPath: typeof payload?.defaultPath === 'string' ? payload.defaultPath : undefined,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (res.canceled || !res.filePath) return { canceled: true as const }
      let fp = normalize(res.filePath)
      if (!fp.toLowerCase().endsWith('.md')) fp += '.md'
      return { canceled: false as const, filePath: fp }
    }
  )

  ipcMain.handle(SPEC_OPS_IPC.dirtyNavigationPrompt, async (event) => {
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

  ipcMain.handle(SPEC_OPS_IPC.confirmDeleteFile, async (event, basename: unknown) => {
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

  ipcMain.handle(
    SPEC_OPS_IPC.renamePathOnDisk,
    async (_evt, payload: { fromPath: unknown; toPath: unknown }) => {
      const from = assertAbsoluteNormalizedPath(String(payload?.fromPath ?? ''))
      const to = assertAbsoluteNormalizedPath(String(payload?.toPath ?? ''))
      if (!from || !to || from === to) return { ok: false as const, reason: 'invalid_path' }
      try {
        await fs.rename(from, to)
        const stat = await fs.stat(to)
        return { ok: true as const, mtimeIso: stat.mtime.toISOString() }
      } catch {
        return { ok: false as const, reason: 'rename_error' }
      }
    }
  )

  ipcMain.handle(SPEC_OPS_IPC.unlinkFilePath, async (_evt, absPath: unknown) => {
    const target =
      typeof absPath === 'string' ? assertAbsoluteNormalizedPath(absPath) : null
    if (!target) return { ok: false as const, reason: 'invalid_path' }
    try {
      await fs.unlink(target)
      return { ok: true as const }
    } catch {
      return { ok: false as const, reason: 'unlink_error' }
    }
  })
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
