import type { MarkdownRenderer } from '../MarkdownRenderer'
import type { MarkdownAst, RenderMarkdownResult } from '../types'
import { MarkdownIssueCodes } from '../types'

import { sanitizePreviewHtml } from './sanitizePreviewHtml'

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Debug-oriented renderer: SpeOps AST as JSON inside a sanitized `<pre>`. */
export class AstJsonMarkdownRenderer implements MarkdownRenderer {
  constructor(private readonly domWindow: Window) {}

  render(ast: MarkdownAst): RenderMarkdownResult {
    try {
      const json = JSON.stringify(ast, null, 2)
      const rawHtml = `<pre>${escapeText(json)}</pre>`
      try {
        const html = sanitizePreviewHtml(rawHtml, this.domWindow)
        return { ok: true, html }
      } catch (e) {
        return {
          ok: false,
          error: {
            code: MarkdownIssueCodes.sanitize_failed,
            message: e instanceof Error ? e.message : 'Preview sanitization failed'
          }
        }
      }
    } catch (e) {
      return {
        ok: false,
        error: {
          code: MarkdownIssueCodes.render_failed,
          message: e instanceof Error ? e.message : 'Markdown render failed'
        }
      }
    }
  }
}
