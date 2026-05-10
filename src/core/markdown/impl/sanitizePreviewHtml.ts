import DOMPurify from 'dompurify'

/** Matches preview-safe URIs per specs/SafePreviewPolicy.md */
export function isAllowedPreviewUri(uri: string): boolean {
  const u = uri.trim()
  if (!u) return false
  const lower = u.toLowerCase()
  const blockedPrefixes = ['javascript:', 'vbscript:', 'data:', 'file:']
  if (blockedPrefixes.some((p) => lower.startsWith(p))) return false
  if (/^https?:\/\//i.test(u)) return true
  if (/^mailto:/i.test(u)) return true
  if (u.startsWith('//')) return false
  if (u.includes(':')) return false
  return true
}

const PREVIEW_ALLOWED_TAGS = [
  'a',
  'blockquote',
  'br',
  'code',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'ul'
] as const

const PREVIEW_ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'start'] as const

export function sanitizePreviewHtml(html: string, domWindow: Window): string {
  const purify = DOMPurify(domWindow)
  purify.removeAllHooks()
  purify.addHook('uponSanitizeAttribute', (_node, hookEvent, _cfg) => {
    if (hookEvent.attrName !== 'href' && hookEvent.attrName !== 'src') return
    const raw = String(hookEvent.attrValue ?? '').trim()
    if (!isAllowedPreviewUri(raw)) {
      hookEvent.keepAttr = false
    }
  })

  return purify.sanitize(html, {
    ALLOW_UNKNOWN_PROTOCOLS: false,
    ALLOW_DATA_ATTR: false,
    ALLOWED_TAGS: [...PREVIEW_ALLOWED_TAGS],
    ALLOWED_ATTR: [...PREVIEW_ALLOWED_ATTR],
    /** Required so text nodes survive sanitization under jsdom + DOMPurify 3.x with an explicit tag allow-list. */
    KEEP_CONTENT: true
  })
}
