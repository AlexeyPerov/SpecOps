import type { MarkdownRenderer } from '../MarkdownRenderer'
import type { MarkdownAst } from '../types'

/** Placeholder until Task 3 produces HTML from a real pipeline. */
export class StubMarkdownRenderer implements MarkdownRenderer {
  render(_ast: MarkdownAst) {
    return { ok: true as const, html: '' }
  }
}
