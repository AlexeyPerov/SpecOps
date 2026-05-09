import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { Root } from 'mdast'

import type { MarkdownParser } from '../MarkdownParser'
import type { ParseMarkdownResult } from '../types'
import { MarkdownIssueCodes } from '../types'

import { mdastRootToSpecOps } from './mdastToSpecOpsAst'

export class RemarkMarkdownParser implements MarkdownParser {
  parse(markdown: string): ParseMarkdownResult {
    try {
      const tree = unified().use(remarkParse).parse(markdown) as Root
      try {
        const ast = mdastRootToSpecOps(tree)
        return { ok: true, ast }
      } catch (e) {
        return {
          ok: false,
          error: {
            code: MarkdownIssueCodes.parse_failed,
            message: e instanceof Error ? e.message : 'Markdown AST normalization failed'
          }
        }
      }
    } catch (e) {
      return {
        ok: false,
        error: {
          code: MarkdownIssueCodes.parse_failed,
          message: e instanceof Error ? e.message : 'Markdown parse failed'
        }
      }
    }
  }
}
