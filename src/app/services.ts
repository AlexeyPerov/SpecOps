import type { MarkdownParser } from '../core/markdown/MarkdownParser'
import type { MarkdownRenderer } from '../core/markdown/MarkdownRenderer'
import { StubMarkdownParser } from '../core/markdown/impl/stubMarkdownParser'
import { StubMarkdownRenderer } from '../core/markdown/impl/stubMarkdownRenderer'

export interface AppServices {
  readonly parser: MarkdownParser
  readonly renderer: MarkdownRenderer
}

/** Application composition root: register concrete adapters here (stubs until Task 3). */
export function createAppServices(): AppServices {
  return {
    parser: new StubMarkdownParser(),
    renderer: new StubMarkdownRenderer()
  }
}
