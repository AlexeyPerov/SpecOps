import { promises as fs } from 'node:fs'
import { dirname, normalize } from 'node:path'
import type { BrowserWindow, Dialog, IpcMain } from 'electron'

import { SPEC_OPS_IPC } from '../../ipc/specOpsIpc'
import {
  normalizeAbsolutePathArg,
  normalizeRenamePathsPayload,
  normalizeWriteTextFilePayload
} from '../../ipc/ipcPayloadNormalize'
import type { createSaveQueue } from '../saveSerialize'

export function registerFileHandlers(
  ipc: IpcMain,
  deps: {
    BrowserWindow: typeof BrowserWindow
    dialog: Dialog
    saveQueue: ReturnType<typeof createSaveQueue>
    syncWatchSlotMtimeAfterOwnWrite: (senderId: number, normalizedAbsolutePath: string, mtimeMs: number) => void
  }
): void {
  const { BrowserWindow, dialog, saveQueue, syncWatchSlotMtimeAfterOwnWrite } = deps

  ipc.handle(SPEC_OPS_IPC.readTextFile, async (_evt, absolutePath: unknown) => {
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

  ipc.handle(
    SPEC_OPS_IPC.writeTextFile,
    async (event, payload: { absolutePath: unknown; content: unknown }) => {
      const wcId = event.sender.id
      return saveQueue.enqueue(wcId, async () => {
        const parsed = normalizeWriteTextFilePayload(payload)
        if (!parsed) {
          return { ok: false as const, reason: 'invalid_payload' }
        }
        const { absolutePath: target, content } = parsed
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

  ipc.handle(SPEC_OPS_IPC.pickOpenMarkdownFile, async (event) => {
    const win =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    })
    if (res.canceled || !res.filePaths[0]) return { canceled: true as const }
    return { canceled: false as const, filePath: normalize(res.filePaths[0]) }
  })

  ipc.handle(
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

  ipc.handle(SPEC_OPS_IPC.renamePathOnDisk, async (_evt, payload: { fromPath: unknown; toPath: unknown }) => {
    const paths = normalizeRenamePathsPayload(payload)
    if (!paths) return { ok: false as const, reason: 'invalid_path' }
    const { fromPath: from, toPath: to } = paths
    try {
      await fs.rename(from, to)
      const stat = await fs.stat(to)
      return { ok: true as const, mtimeIso: stat.mtime.toISOString() }
    } catch {
      return { ok: false as const, reason: 'rename_error' }
    }
  })

  ipc.handle(SPEC_OPS_IPC.unlinkFilePath, async (_evt, absPath: unknown) => {
    const target = normalizeAbsolutePathArg(absPath)
    if (!target) return { ok: false as const, reason: 'invalid_path' }
    try {
      await fs.unlink(target)
      return { ok: true as const }
    } catch {
      return { ok: false as const, reason: 'unlink_error' }
    }
  })
}
