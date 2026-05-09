import type { MarkdownParser } from '../core/markdown/MarkdownParser'
import type { MarkdownRenderer } from '../core/markdown/MarkdownRenderer'
import { HtmlMarkdownRenderer } from '../core/markdown/impl/htmlMarkdownRenderer'
import { RemarkMarkdownParser } from '../core/markdown/impl/remarkMarkdownParser'

export interface AppServices {
  readonly parser: MarkdownParser
  readonly renderer: MarkdownRenderer
}

/** Application composition root: register concrete markdown adapters here. */
export function createAppServices(): AppServices {
  return {
    parser: new RemarkMarkdownParser(),
    renderer: new HtmlMarkdownRenderer(globalThis.window)
  }
}
