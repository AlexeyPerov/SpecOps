import { isAbsolute, normalize, resolve } from 'node:path'

/**
 * Shared IPC payload normalization (RR-04.2 / RR-04.7). Used by main handlers and contract tests.
 */
export function normalizeAbsolutePathArg(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const r = normalize(resolve(raw.trim()))
    if (!isAbsolute(r)) return null
    return r
  } catch {
    return null
  }
}

export function normalizeWriteTextFilePayload(
  payload: unknown
): { absolutePath: string; content: string } | null {
  if (payload === null || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const absolutePath = normalizeAbsolutePathArg(String(p.absolutePath ?? ''))
  const content = p.content
  if (!absolutePath || typeof content !== 'string') return null
  return { absolutePath, content }
}

export function normalizeRenamePathsPayload(
  payload: unknown
): { fromPath: string; toPath: string } | null {
  if (payload === null || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const fromPath = normalizeAbsolutePathArg(String(p.fromPath ?? ''))
  const toPath = normalizeAbsolutePathArg(String(p.toPath ?? ''))
  if (!fromPath || !toPath || fromPath === toPath) return null
  return { fromPath, toPath }
}
