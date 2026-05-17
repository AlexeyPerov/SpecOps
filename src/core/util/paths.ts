/** Normalized doc id for a file-backed document (forward slashes). */
export function stableDocIdForPath(absolutePath: string): string {
  return absolutePath.replace(/\\/g, '/')
}

export function pathBasename(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  return i >= 0 ? norm.slice(i + 1) : norm
}

/** Replace final path segment; preserves mixed Windows-style prefixes when needed. */
export function replaceBasename(absolutePath: string, newBasename: string): string {
  const norm = absolutePath.replace(/\\/g, '/')
  const li = norm.lastIndexOf('/')
  if (li < 0) return newBasename
  const prefixSlash = norm.slice(0, li)
  if (absolutePath.includes('\\') && !absolutePath.includes('/')) {
    return `${prefixSlash.replace(/\//g, '\\')}\\${newBasename}`
  }
  return `${prefixSlash}/${newBasename}`
}

export function deriveUntitledTitle(content: string): string {
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length > 0) {
      return trimmed.length > 60 ? trimmed.slice(0, 60) : trimmed
    }
  }
  return 'Untitled'
}
