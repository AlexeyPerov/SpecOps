/** Escape text for HTML highlight overlay (textarea mirror). */

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function highlightLinkLabelHtml(label: string): string {
  const parts: string[] = []
  let j = 0
  while (j < label.length) {
    const rest = label.slice(j)
    const codeMatch = /^`([^`]*)`/.exec(rest)
    if (codeMatch) {
      parts.push(
        `<span class="editor-hl-inline-code">${escapeHtmlText(codeMatch[0])}</span>`
      )
      j += codeMatch[0].length
      continue
    }
    parts.push(escapeHtmlText(label[j]!))
    j += 1
  }
  return parts.join('')
}

/**
 * Builds HTML for the syntax highlight layer behind the editor.
 * Highlights: inline `code`, and targets inside markdown links `[text](url)`.
 */
export function buildEditorHighlightHtml(text: string): string {
  const out: string[] = []
  let i = 0
  const n = text.length
  while (i < n) {
    const slice = text.slice(i)
    if (slice.startsWith('`')) {
      const codeMatch = /^`([^`]*)`/.exec(slice)
      if (codeMatch) {
        out.push(
          `<span class="editor-hl-inline-code">${escapeHtmlText(codeMatch[0])}</span>`
        )
        i += codeMatch[0].length
        continue
      }
    }
    const linkMatch = /^\[([^\]]*)\]\(([^)]+)\)/.exec(slice)
    if (linkMatch) {
      out.push(escapeHtmlText('['))
      out.push(highlightLinkLabelHtml(linkMatch[1]))
      out.push(escapeHtmlText(']('))
      out.push(`<span class="editor-hl-link-target">${escapeHtmlText(linkMatch[2])}</span>`)
      out.push(escapeHtmlText(')'))
      i += linkMatch[0].length
      continue
    }
    out.push(escapeHtmlText(slice[0]!))
    i += 1
  }
  return out.join('')
}
