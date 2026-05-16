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

const MAX_READ_TEXT_BYTES = 2 * 1024 * 1024
const MAX_REPLACEMENT_CHAR_RATIO = 0.02
const MAX_REPLACEMENT_CHAR_COUNT = 64

export function hasNulByte(buffer: Buffer): boolean {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0) return true
  }
  return false
}

export function replacementCharRatio(text: string): number {
  if (!text.length) return 0
  let replacementCount = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0xfffd) replacementCount++
  }
  if (replacementCount <= MAX_REPLACEMENT_CHAR_COUNT) return 0
  return replacementCount / text.length
}

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
      const stat = await fs.stat(target)
      if (!stat.isFile()) return { ok: false as const, reason: 'unreadable' }
      if (stat.size > MAX_READ_TEXT_BYTES) return { ok: false as const, reason: 'too_large' }
      const raw = await fs.readFile(target)
      if (hasNulByte(raw)) return { ok: false as const, reason: 'binary' }
      const content = raw.toString('utf8')
      if (replacementCharRatio(content) > MAX_REPLACEMENT_CHAR_RATIO) {
        return { ok: false as const, reason: 'unreadable' }
      }
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

  ipc.handle(SPEC_OPS_IPC.pickOpenFile, async (event) => {
    const win =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths[0]) return { canceled: true as const }
    return { canceled: false as const, filePath: normalize(res.filePaths[0]) }
  })

  ipc.handle(
    SPEC_OPS_IPC.pickSaveFile,
    async (event, payload?: { defaultPath?: string }) => {
      const win =
        BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
      const res = await dialog.showSaveDialog(win, {
        defaultPath: typeof payload?.defaultPath === 'string' ? payload.defaultPath : undefined
      })
      if (res.canceled || !res.filePath) return { canceled: true as const }
      return { canceled: false as const, filePath: normalize(res.filePath) }
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
