import { promises as fs, readdirSync, type Dirent } from 'node:fs'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import type { BrowserWindow, Dialog, IpcMain, Shell } from 'electron'

import { SPEC_OPS_IPC, type TreeNode } from '../../ipc/specOpsIpc'

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

function isPathContained(parentResolved: string, childResolved: string): boolean {
  const rel = relative(parentResolved, childResolved)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export function registerWorkspaceHandlers(
  ipc: IpcMain,
  deps: {
    BrowserWindow: typeof BrowserWindow
    dialog: Dialog
    shell: Shell
  }
): void {
  const { BrowserWindow, dialog, shell } = deps

  ipc.handle(SPEC_OPS_IPC.pickWorkspaceFolder, async (event) => {
    const win =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
    const res = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    return res.filePaths[0]
  })

  ipc.handle(SPEC_OPS_IPC.revealInFolder, async (_evt, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath.trim()) return
    shell.showItemInFolder(normalize(filePath))
  })

  ipc.handle(
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

  ipc.handle(SPEC_OPS_IPC.listMarkdownFilesRecursive, async (_evt, folderPath: unknown) => {
    if (typeof folderPath !== 'string' || !folderPath.trim()) return []
    const rootDir = resolve(folderPath)
    const out: string[] = []
    const stack: string[] = [rootDir]
    while (stack.length > 0) {
      const current = stack.pop()!
      let entries: Awaited<ReturnType<typeof fs.readdir>>
      try {
        entries = await fs.readdir(current, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        const abs = normalize(join(current, entry.name))
        if (entry.isDirectory()) {
          stack.push(abs)
          continue
        }
        if (!entry.isFile()) continue
        const lower = entry.name.toLowerCase()
        if (lower.endsWith('.md') || lower.endsWith('.markdown')) out.push(abs)
      }
    }
    out.sort((a, b) => a.localeCompare(b))
    return out
  })

  ipc.handle(SPEC_OPS_IPC.listProjectTree, async (_evt, payload: {
    rootPath: unknown
    excludeGitDirectory?: unknown
    excludeNodeModules?: unknown
  }) => {
    const rootPath = payload?.rootPath
    if (typeof rootPath !== 'string' || !rootPath.trim()) return []
    const rootDir = resolve(rootPath)
    const excludeGit = payload.excludeGitDirectory !== false
    const excludeNodeModules = payload.excludeNodeModules !== false

    function buildTree(dir: string, depth: number): TreeNode[] {
      if (depth > 20) return []
      let entries: Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true }) as Dirent[]
      } catch {
        return []
      }
      const result: TreeNode[] = []
      const dirs: { name: string; abs: string }[] = []

      for (const entry of entries) {
        const name = entry.name as string
        if (excludeGit && name === '.git') continue
        if (excludeNodeModules && name === 'node_modules') continue
        const abs = normalize(join(dir, name))
        if (entry.isDirectory()) {
          dirs.push({ name, abs })
        } else if (entry.isFile()) {
          result.push({ name, absolutePath: abs, isDirectory: false, children: [] })
        }
      }

      dirs.sort((a, b) => a.name.localeCompare(b.name))
      result.sort((a, b) => a.name.localeCompare(b.name))

      const dirNodes: TreeNode[] = []
      for (const { name, abs } of dirs) {
        const children = buildTree(abs, depth + 1)
        dirNodes.push({ name, absolutePath: abs, isDirectory: true, children })
      }

      return [...dirNodes, ...result]
    }

    return buildTree(rootDir, 0)
  })
}
