import type { MarkdownParser } from '../core/markdown/MarkdownParser'
import type { MarkdownRenderer } from '../core/markdown/MarkdownRenderer'
import { RemarkMarkdownParser } from '../core/markdown/impl/remarkMarkdownParser'

import {
  createMarkdownRenderer,
  type BuiltinMarkdownRendererId
} from './markdownComposition'

export interface AppServices {
  readonly parser: MarkdownParser
  readonly renderer: MarkdownRenderer
}

export interface CreateAppServicesOptions {
  markdownRenderer?: BuiltinMarkdownRendererId
  /** When set, overrides `markdownRenderer` (tests / custom integrations). */
  renderer?: MarkdownRenderer
}

/** Application composition root: register concrete markdown adapters here. */
export function createAppServices(options?: CreateAppServicesOptions): AppServices {
  const win = globalThis.window
  const renderer =
    options?.renderer ??
    createMarkdownRenderer(options?.markdownRenderer ?? 'html', win)
  return {
    parser: new RemarkMarkdownParser(),
    renderer
  }
}
