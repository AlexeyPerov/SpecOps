import type { MarkdownRenderer } from '../core/markdown/MarkdownRenderer'
import { AstJsonMarkdownRenderer } from '../core/markdown/impl/astJsonMarkdownRenderer'
import { HtmlMarkdownRenderer } from '../core/markdown/impl/htmlMarkdownRenderer'

/** Built-in preview renderer identifiers (composition root only). */
export type BuiltinMarkdownRendererId = 'html' | 'astJson'

export function createMarkdownRenderer(
  id: BuiltinMarkdownRendererId,
  domWindow: Window
): MarkdownRenderer {
  switch (id) {
    case 'html':
      return new HtmlMarkdownRenderer(domWindow)
    case 'astJson':
      return new AstJsonMarkdownRenderer(domWindow)
    default: {
      const _never: never = id
      return _never
    }
  }
}

/** Normalize optional env override (`VITE_MARKDOWN_RENDERER`) to a built-in id. */
export function markdownRendererIdFromEnv(raw: string | undefined): BuiltinMarkdownRendererId {
  return raw === 'astJson' ? 'astJson' : 'html'
}
