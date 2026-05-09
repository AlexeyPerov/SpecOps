import type { ParseMarkdownResult } from './types'

export interface MarkdownParser {
  parse(markdown: string): ParseMarkdownResult
}
