import type { MarkdownAst, RenderMarkdownResult } from './types'

export interface MarkdownRenderer {
  render(ast: MarkdownAst): RenderMarkdownResult
}
