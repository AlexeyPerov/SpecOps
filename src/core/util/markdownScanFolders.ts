/** Relative roots under each project workspace where markdown is scanned for recents. */

export function sanitizeMarkdownScanRelativeFolderLine(raw: string): string | null {
  let s = raw.trim().replace(/\\/g, '/')
  while (s.startsWith('./')) s = s.slice(2)
  while (s.startsWith('/')) s = s.slice(1)
  if (!s) return null
  if (/^[a-zA-Z]:/.test(s)) return null
  const segments = s.split('/').filter(Boolean)
  for (const seg of segments) {
    if (seg === '..' || seg === '.') return null
  }
  return segments.join('/')
}

export function sanitizeMarkdownScanRelativeFolders(raw: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of raw) {
    const s = sanitizeMarkdownScanRelativeFolderLine(typeof line === 'string' ? line : '')
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

export function sanitizeMarkdownScanFolderLines(block: string): readonly string[] {
  return sanitizeMarkdownScanRelativeFolders(block.split(/\r?\n/))
}

function normalizeRoot(projectRoot: string): string {
  return projectRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Resolved absolute scan root, or null if `relativeFolder` is unsafe or escapes `projectRoot`. */
export function resolveContainedScanRoot(projectRoot: string, relativeFolder: string): string | null {
  const rel = sanitizeMarkdownScanRelativeFolderLine(relativeFolder)
  if (!rel) return null
  const root = normalizeRoot(projectRoot)
  if (!root) return null
  const candidate = `${root}/${rel}`.replace(/\/+/g, '/')
  const prefix = `${root}/`
  if (candidate !== root && !candidate.startsWith(prefix)) return null
  return candidate
}
