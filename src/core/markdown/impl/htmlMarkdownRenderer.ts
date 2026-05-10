import type { MarkdownRenderer } from '../MarkdownRenderer'
import type {
  MarkdownAst,
  MarkdownAstBlock,
  MarkdownAstInline,
  MarkdownListItemBlock,
  MarkdownTableBlock,
  RenderMarkdownResult
} from '../types'
import { MarkdownIssueCodes } from '../types'

import { sanitizePreviewHtml } from './sanitizePreviewHtml'

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;')
}

export class HtmlMarkdownRenderer implements MarkdownRenderer {
  constructor(private readonly domWindow: Window) {}

  render(ast: MarkdownAst): RenderMarkdownResult {
    try {
      const rawHtml = renderRoot(ast)
      try {
        const html = sanitizePreviewHtml(rawHtml, this.domWindow)
        return { ok: true, html }
      } catch (e) {
        return {
          ok: false,
          error: {
            code: MarkdownIssueCodes.sanitize_failed,
            message: e instanceof Error ? e.message : 'Preview sanitization failed'
          }
        }
      }
    } catch (e) {
      return {
        ok: false,
        error: {
          code: MarkdownIssueCodes.render_failed,
          message: e instanceof Error ? e.message : 'Markdown render failed'
        }
      }
    }
  }
}

function renderRoot(ast: MarkdownAst): string {
  return ast.children.map(renderBlock).join('')
}

function renderBlock(block: MarkdownAstBlock): string {
  switch (block.type) {
    case 'heading': {
      const d = block.depth
      const inner = block.children.map(renderInline).join('')
      return `<h${d}>${inner}</h${d}>`
    }
    case 'paragraph':
      return `<p>${block.children.map(renderInline).join('')}</p>`
    case 'thematicBreak':
      return '<hr />'
    case 'blockquote':
      return `<blockquote>${block.children.map(renderBlock).join('')}</blockquote>`
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      const start =
        block.ordered && block.start !== undefined && block.start !== 1
          ? ` start="${escapeAttr(String(block.start))}"`
          : ''
      const inner = block.children.map(renderListItem).join('')
      return `<${Tag}${start}>${inner}</${Tag}>`
    }
    case 'codeBlock': {
      const escaped = escapeText(block.value)
      return `<pre><code>${escaped}</code></pre>`
    }
    case 'table':
      return renderTable(block)
    default:
      return ''
  }
}

function renderTable(block: MarkdownTableBlock): string {
  const rows = block.children
  if (!rows.length) return '<table></table>'
  const align = block.align
  function cellAttrs(colIndex: number): string {
    const a = align[colIndex] ?? null
    if (!a) return ''
    return ` align="${escapeAttr(a)}"`
  }
  const headerRow = rows[0]!
  const bodyRows = rows.slice(1)
  const ths = headerRow.children
    .map((cell, i) => `<th${cellAttrs(i)}>${cell.children.map(renderInline).join('')}</th>`)
    .join('')
  const thead = `<thead><tr>${ths}</tr></thead>`
  const tbody =
    bodyRows.length === 0
      ? ''
      : `<tbody>${bodyRows
          .map(
            (row) =>
              `<tr>${row.children.map((cell, i) => `<td${cellAttrs(i)}>${cell.children.map(renderInline).join('')}</td>`).join('')}</tr>`
          )
          .join('')}</tbody>`
  return `<table>${thead}${tbody}</table>`
}

function renderListItem(item: MarkdownListItemBlock): string {
  const cb =
    item.checked === true || item.checked === false
      ? `<input type="checkbox" disabled${item.checked ? ' checked' : ''} /> `
      : ''
  const inner = item.children.map(renderBlock).join('')
  return `<li>${cb}${inner}</li>`
}

function renderInline(node: MarkdownAstInline): string {
  switch (node.type) {
    case 'text':
      return escapeText(node.value)
    case 'break':
      return '<br />'
    case 'inlineCode':
      return `<code>${escapeText(node.value)}</code>`
    case 'emphasis':
      return `<em>${node.children.map(renderInline).join('')}</em>`
    case 'strong':
      return `<strong>${node.children.map(renderInline).join('')}</strong>`
    case 'link': {
      const inner = node.children.map(renderInline).join('')
      const title =
        node.title !== undefined ? ` title="${escapeAttr(node.title)}"` : ''
      return `<a href="${escapeAttr(node.url)}"${title}>${inner}</a>`
    }
    case 'image': {
      const title =
        node.title !== undefined ? ` title="${escapeAttr(node.title)}"` : ''
      return `<img src="${escapeAttr(node.url)}" alt="${escapeAttr(node.alt)}"${title} />`
    }
    case 'delete':
      return `<del>${node.children.map(renderInline).join('')}</del>`
    default:
      return ''
  }
}
