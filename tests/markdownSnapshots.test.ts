// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { RemarkMarkdownParser } from '../src/core/markdown/impl/remarkMarkdownParser'
import { HtmlMarkdownRenderer } from '../src/core/markdown/impl/htmlMarkdownRenderer'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

function readFx(relFromRepo: string): string {
  return readFileSync(join(repoRoot, relFromRepo), 'utf8')
}

function pipelineHtml(markdown: string): string {
  const parser = new RemarkMarkdownParser()
  const renderer = new HtmlMarkdownRenderer(window)
  const p = parser.parse(markdown)
  expect(p.ok).toBe(true)
  if (!p.ok) throw new Error('parse')
  const r = renderer.render(p.ast)
  expect(r.ok).toBe(true)
  if (!r.ok) throw new Error('render')
  return r.html
}

const fr01Files = [
  'heading.md',
  'paragraph-emphasis.md',
  'list-unordered.md',
  'list-ordered.md',
  'link.md',
  'image.md',
  'blockquote.md',
  'code-fence.md',
  'thematic-break.md',
  'inline-code.md'
] as const

const test09Files = ['table.md', 'task-list.md', 'strikethrough.md'] as const

describe('markdown sanitized HTML snapshots (TEST-03)', () => {
  it.each(fr01Files)('fr01/%s', (file) => {
    const md = readFx(`fixtures/markdown/fr01/${file}`)
    expect(pipelineHtml(md)).toMatchSnapshot()
  })
})

describe('markdown GFM snapshots (TEST-09)', () => {
  it.each(test09Files)('test09/%s', (file) => {
    const md = readFx(`fixtures/markdown/test09/${file}`)
    expect(pipelineHtml(md)).toMatchSnapshot()
  })
})

describe('markdown resilience snapshots (TEST-04)', () => {
  it('hostile-uris.md', () => {
    const md = readFx('fixtures/markdown-resilience/hostile-uris.md')
    expect(pipelineHtml(md)).toMatchSnapshot()
  })

  it('malformed.md', () => {
    const md = readFx('fixtures/markdown-resilience/malformed.md')
    expect(pipelineHtml(md)).toMatchSnapshot()
  })
})

describe('AC-05 pipeline does not throw', () => {
  it('representative hostile / odd inputs return results without throwing', () => {
    const parser = new RemarkMarkdownParser()
    const renderer = new HtmlMarkdownRenderer(window)
    const samples = [
      '',
      '###',
      '[x](javascript:alert(1))',
      '![z](data:text/html,<bad>)',
      readFx('fixtures/markdown-resilience/malformed.md')
    ]
    for (const md of samples) {
      expect(() => parser.parse(md)).not.toThrow()
      const pr = parser.parse(md)
      expect(pr.ok === true || pr.ok === false).toBe(true)
      if (pr.ok) {
        expect(() => renderer.render(pr.ast)).not.toThrow()
        const rr = renderer.render(pr.ast)
        expect(rr.ok === true || rr.ok === false).toBe(true)
      }
    }
  })
})
