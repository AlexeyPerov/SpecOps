import type { MarkdownParser } from '../MarkdownParser'
import type { MarkdownAst } from '../types'

/** Placeholder until Task 3 wires a real parser. */
export class StubMarkdownParser implements MarkdownParser {
  parse(_markdown: string) {
    const ast: MarkdownAst = {
      type: 'root',
      children: []
    }
    return { ok: true as const, ast }
  }
}
