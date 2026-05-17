import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { IpcMain } from 'electron'

import { SPEC_OPS_IPC, type GitSummaryResult } from '../../ipc/specOpsIpc'

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 5000

function parseBranchOutput(stdout: string): string | null {
  const line = stdout.trim()
  if (!line) return null
  if (line.startsWith('refs/heads/')) return line.slice('refs/heads/'.length)
  if (line.startsWith('(')) return line
  return line
}

export function registerGitHandlers(ipc: IpcMain): void {
  ipc.handle(SPEC_OPS_IPC.gitSummary, async (_evt, workspacePath: unknown) => {
    if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
      return { isRepo: false, branch: null } satisfies GitSummaryResult
    }
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-parse', '--is-inside-work-tree', '--abbrev-ref', 'HEAD'],
        { cwd: workspacePath, timeout: GIT_TIMEOUT_MS, encoding: 'utf8' }
      )
      const lines = stdout.trim().split('\n')
      const isInside = lines[0]?.trim() === 'true'
      if (!isInside) return { isRepo: false, branch: null } satisfies GitSummaryResult
      const branch = parseBranchOutput(lines[1] ?? '')
      return { isRepo: true, branch } satisfies GitSummaryResult
    } catch {
      return { isRepo: false, branch: null } satisfies GitSummaryResult
    }
  })
}
