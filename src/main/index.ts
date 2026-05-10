import { watch } from 'node:fs'
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
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'

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
}

const watchSlots = new Map<number, WatchSlot>()

function watchSlotFor(senderId: number): WatchSlot {
  let slot = watchSlots.get(senderId)
  if (!slot) {
    slot = { absolutePath: null, watcher: null, debounceTimer: null }
    watchSlots.set(senderId, slot)
  }
  return slot
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
}

function registerSpecOpsHandlers(): void {
  ipcMain.on('specops:get-app-version', (event) => {
    event.returnValue = app.getVersion()
  })
  ipcMain.on('specops:get-platform', (event) => {
    event.returnValue = process.platform
  })

  ipcMain.handle('specops:resolve-repo-path', (_evt, segments: string[]) => {
    return join(repoRoot(), ...segments)
  })

  ipcMain.handle(
    'specops:read-markdown-asset',
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

  ipcMain.handle('specops:pick-workspace-folder', async (event) => {
    const win =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
    const res = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    return res.filePaths[0]
  })

  ipcMain.handle('specops:reveal-in-folder', async (_evt, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath.trim()) return
    shell.showItemInFolder(normalize(filePath))
  })

  ipcMain.handle('specops:read-text-file', async (_evt, absolutePath: unknown) => {
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
    'specops:create-markdown-in-workspace',
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

  ipcMain.handle('specops:set-watched-doc-path', async (event, filePath: unknown) => {
    const slot = watchSlotFor(event.sender.id)
    stopDocWatcher(slot)
    if (typeof filePath !== 'string' || !filePath.trim()) return

    slot.absolutePath = normalize(filePath)
    try {
      slot.watcher = watch(slot.absolutePath, () => {
        if (slot.debounceTimer) clearTimeout(slot.debounceTimer)
        slot.debounceTimer = setTimeout(() => {
          void (async () => {
            const target = slot.absolutePath
            if (!target) return
            try {
              const content = await fs.readFile(target, 'utf8')
              const stat = await fs.stat(target)
              event.sender.send('specops:external-file-changed', {
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
}

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const preload = join(__dirname, '../preload/index.mjs')

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 680,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  registerSpecOpsHandlers()
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
