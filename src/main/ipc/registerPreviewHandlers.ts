import { dirname, join, normalize, relative } from 'node:path'
import { promises as fs } from 'node:fs'
import type { IpcMain } from 'electron'

import { SPEC_OPS_IPC } from '../../ipc/specOpsIpc'

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

export function registerPreviewHandlers(ipc: IpcMain): void {
  ipc.handle(
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
}
