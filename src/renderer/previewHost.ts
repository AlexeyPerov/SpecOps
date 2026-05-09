import type { SpecOpsPreloadApi } from '../preload/specOpsApi'

const trackedBlobUrls = new Set<string>()

function revokeTracked(): void {
  for (const u of trackedBlobUrls) URL.revokeObjectURL(u)
  trackedBlobUrls.clear()
}

/** True when URL should be resolved on disk relative to the markdown file (post-sanitize). */
export function isRelativeAssetUrl(src: string): boolean {
  const u = src.trim()
  if (!u) return false
  const lower = u.toLowerCase()
  if (lower.startsWith('blob:')) return false
  if (lower.startsWith('http:') || lower.startsWith('https:') || lower.startsWith('mailto:')) return false
  if (u.startsWith('//')) return false
  if (
    lower.startsWith('data:') ||
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:')
  ) {
    return false
  }
  return true
}

function escapeFallbackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Wire capture-phase handlers once per preview root (EH-03/EH-04 + safe navigation). */
export function attachPreviewChrome(container: HTMLElement): void {
  container.addEventListener(
    'error',
    (event) => {
      const t = event.target
      if (!(t instanceof HTMLImageElement) || !container.contains(t)) return
      const span = document.createElement('span')
      span.className = 'preview-fallback'
      span.textContent = t.alt?.trim() ? t.alt : 'Image failed to load'
      t.replaceWith(span)
    },
    true
  )

  container.addEventListener(
    'click',
    (event) => {
      const el = event.target
      if (!(el instanceof Element)) return
      const anchor = el.closest('a')
      if (!anchor || !container.contains(anchor)) return
      event.preventDefault()
    },
    true
  )
}

type AssetApi = Pick<SpecOpsPreloadApi, 'readMarkdownAsset'>

async function rewriteRelativeImages(
  html: string,
  docPath: string,
  api: AssetApi
): Promise<string> {
  const parser = new DOMParser()
  const parsed = parser.parseFromString(html, 'text/html')
  const imgs = [...parsed.body.querySelectorAll('img[src]')] as HTMLImageElement[]

  for (const img of imgs) {
    const src = img.getAttribute('src')
    if (!src || !isRelativeAssetUrl(src)) continue
    const result = await api.readMarkdownAsset({ docPath, relativeUrl: src })
    if (!result.ok) continue
    const binary = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0))
    const blob = new Blob([binary], { type: result.mimeType })
    const url = URL.createObjectURL(blob)
    trackedBlobUrls.add(url)
    img.setAttribute('src', url)
  }

  return parsed.body.innerHTML
}

/** Mount sanitized HTML; optionally resolve local images when `docPath` is absolute (NFR-08). */
export async function mountPreview(
  container: HTMLElement,
  html: string,
  docPath: string | null,
  api: AssetApi
): Promise<void> {
  revokeTracked()

  let bodyHtml = html
  if (docPath) {
    bodyHtml = await rewriteRelativeImages(html, docPath, api)
  }

  container.innerHTML = bodyHtml
}

/** Escape plain text for inline fallback snippets inside preview HTML. */
export function previewErrorSnippet(message: string): string {
  return `<p class="preview-fallback">${escapeFallbackText(message)}</p>`
}
