import { watch } from 'node:fs'
import { promises as fs } from 'node:fs'
import { normalize } from 'node:path'
import type { IpcMain } from 'electron'

import { SPEC_OPS_IPC } from '../../ipc/specOpsIpc'

type WatchSlot = {
  absolutePath: string | null
  watcher: ReturnType<typeof watch> | null
  debounceTimer: ReturnType<typeof setTimeout> | null
  lastSeenMtimeMs: number | null
}

function watchSlotFor(watchSlots: Map<number, WatchSlot>, senderId: number): WatchSlot {
  let slot = watchSlots.get(senderId)
  if (!slot) {
    slot = { absolutePath: null, watcher: null, debounceTimer: null, lastSeenMtimeMs: null }
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
  slot.lastSeenMtimeMs = null
}

export function registerWatcherHandlers(ipc: IpcMain): {
  syncWatchSlotMtimeAfterOwnWrite: (senderId: number, normalizedAbsolutePath: string, mtimeMs: number) => void
} {
  const watchSlots = new Map<number, WatchSlot>()

  const syncWatchSlotMtimeAfterOwnWrite = (
    senderId: number,
    normalizedAbsolutePath: string,
    mtimeMs: number
  ): void => {
    const slot = watchSlots.get(senderId)
    if (!slot?.absolutePath) return
    if (normalize(slot.absolutePath) !== normalize(normalizedAbsolutePath)) return
    slot.lastSeenMtimeMs = mtimeMs
  }

  ipc.handle(SPEC_OPS_IPC.setWatchedDocPath, async (event, filePath: unknown) => {
    const slot = watchSlotFor(watchSlots, event.sender.id)
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

  return { syncWatchSlotMtimeAfterOwnWrite }
}
