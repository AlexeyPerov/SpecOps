import { promises as fs } from 'node:fs'
import { join, dirname, relative, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain } from 'electron'

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
