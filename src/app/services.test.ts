// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { markdownRendererIdFromEnv } from './markdownComposition'
import { createAppServices } from './services'

describe('markdownRendererIdFromEnv', () => {
  it('maps astJson and defaults otherwise', () => {
    expect(markdownRendererIdFromEnv(undefined)).toBe('html')
    expect(markdownRendererIdFromEnv('astJson')).toBe('astJson')
    expect(markdownRendererIdFromEnv('')).toBe('html')
    expect(markdownRendererIdFromEnv('unknown')).toBe('html')
  })
})

describe('createAppServices', () => {
  it('defaults to HTML renderer pipeline', () => {
    const services = createAppServices()
    const parsed = services.parser.parse('# Hi')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse')
    const rendered = services.renderer.render(parsed.ast)
    expect(rendered.ok).toBe(true)
    if (!rendered.ok) throw new Error('render')
    expect(rendered.html).toContain('<h1>')
    expect(rendered.html).toContain('Hi')
  })

  it('uses AstJson renderer when markdownRenderer is astJson', () => {
    const services = createAppServices({ markdownRenderer: 'astJson' })
    const parsed = services.parser.parse('# Hi')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('parse')
    const rendered = services.renderer.render(parsed.ast)
    expect(rendered.ok).toBe(true)
    if (!rendered.ok) throw new Error('render')
    expect(rendered.html).toContain('<pre>')
    expect(rendered.html).toContain('"type": "root"')
    expect(rendered.html).toContain('"type": "heading"')
  })

  it('allows injecting a custom renderer instance', () => {
    const services = createAppServices({
      renderer: {
        render: () => ({ ok: true as const, html: '<p class="custom">x</p>' })
      }
    })
    const rendered = services.renderer.render({
      type: 'root',
      children: []
    })
    expect(rendered.ok).toBe(true)
    if (!rendered.ok) throw new Error('render')
    expect(rendered.html).toContain('custom')
  })
})
