import { describe, expect, it } from 'vitest'

import { buildEditorHighlightHtml } from '../src/renderer/editor/editorHighlight'

describe('buildEditorHighlightHtml', () => {
  it('highlights inline code and link target for changelog example', () => {
    const md = '[`../Changelog.md`](../Changelog.md)'
    const html = buildEditorHighlightHtml(md)
    expect(html).toContain('class="editor-hl-inline-code">`../Changelog.md`</span>')
    expect(html).toContain('class="editor-hl-link-target">../Changelog.md</span>')
  })

  it('handles plain text', () => {
    expect(buildEditorHighlightHtml('hello')).toBe('hello')
  })
})
