import type {
  BlockContent,
  DefinitionContent,
  ImageReference,
  LinkReference,
  ListContent,
  PhrasingContent,
  Root,
  Table,
  TableCell,
  TableRow
} from 'mdast'
import type {
  MarkdownAstBlock,
  MarkdownAstInline,
  MarkdownAstRoot,
  MarkdownListItemBlock,
  MarkdownTableCellBlock,
  MarkdownTableRowBlock
} from '../types'

/** Visible-ish fallback when encountering unsupported mdast nodes (never throws). */
function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, '')
}

function paragraphPlain(children: readonly MarkdownAstInline[]): MarkdownAstBlock {
  return {
    type: 'paragraph',
    children
  }
}

function paragraphFromLiteral(content: string): MarkdownAstBlock {
  return paragraphPlain([{ type: 'text', value: content }])
}

function convertPhrasing(nodes: readonly PhrasingContent[]): MarkdownAstInline[] {
  const out: MarkdownAstInline[] = []
  for (const node of nodes) {
    const part = convertPhrasingNode(node)
    out.push(...part)
  }
  return out
}

function convertPhrasingNode(node: PhrasingContent): MarkdownAstInline[] {
  if ((node as { type: string }).type === 'delete') {
    const d = node as unknown as { type: 'delete'; children: PhrasingContent[] }
    return [{ type: 'delete', children: convertPhrasing(d.children as readonly PhrasingContent[]) }]
  }
  switch (node.type) {
    case 'text':
      return [{ type: 'text', value: node.value }]
    case 'break':
      return [{ type: 'break' }]
    case 'inlineCode':
      return [{ type: 'inlineCode', value: node.value }]
    case 'emphasis':
      return [
        {
          type: 'emphasis',
          children: convertPhrasing(node.children)
        }
      ]
    case 'strong':
      return [
        {
          type: 'strong',
          children: convertPhrasing(node.children)
        }
      ]
    case 'link':
      return [
        {
          type: 'link',
          url: node.url,
          title: node.title ?? undefined,
          children: convertPhrasing(node.children)
        }
      ]
    case 'image':
      return [
        {
          type: 'image',
          url: node.url,
          title: node.title ?? undefined,
          alt: node.alt ?? ''
        }
      ]
    case 'linkReference':
      return convertLinkReference(node)
    case 'imageReference':
      return convertImageReference(node)
    case 'html':
      return [{ type: 'text', value: stripHtmlTags(node.value) }]
    default:
      return unsupportedInlineFallback(node)
  }
}

function convertLinkReference(node: LinkReference): MarkdownAstInline[] {
  const inner = convertPhrasing(node.children)
  if (!inner.length) {
    return [{ type: 'text', value: '' }]
  }
  return [
    {
      type: 'link',
      url: '',
      title: undefined,
      children: inner
    }
  ]
}

function convertImageReference(node: ImageReference): MarkdownAstInline[] {
  return [
    {
      type: 'image',
      url: '',
      title: undefined,
      alt: node.alt ?? ''
    }
  ]
}

function unsupportedInlineFallback(node: PhrasingContent): MarkdownAstInline[] {
  return [{ type: 'text', value: `[${node.type}]` }]
}

function convertTableCell(cell: TableCell): MarkdownTableCellBlock {
  return {
    type: 'tableCell',
    children: convertPhrasing(cell.children as readonly PhrasingContent[])
  }
}

function convertTableRow(row: TableRow): MarkdownTableRowBlock {
  return {
    type: 'tableRow',
    children: row.children.filter((c): c is TableCell => c.type === 'tableCell').map(convertTableCell)
  }
}

function convertTable(node: Table): MarkdownAstBlock {
  const rows = node.children.filter((r): r is TableRow => r.type === 'tableRow').map(convertTableRow)
  const rawAlign = node.align ?? []
  const align = rawAlign.map((a): 'left' | 'center' | 'right' | null =>
    a === 'left' || a === 'center' || a === 'right' ? a : null
  )
  return { type: 'table', align, children: rows }
}

function convertListChildren(children: readonly ListContent[]): MarkdownListItemBlock[] {
  return children.flatMap((c): MarkdownListItemBlock[] => {
    if (c.type !== 'listItem') return []
    return [
      {
        type: 'listItem',
        checked: c.checked ?? null,
        children: convertBlocksWithoutDefinitions(c.children)
      }
    ]
  })
}

function convertBlocksWithoutDefinitions(
  nodes: ReadonlyArray<BlockContent | DefinitionContent>
): MarkdownAstBlock[] {
  const blocks: MarkdownAstBlock[] = []
  for (const node of nodes) {
    const b = convertBlock(node)
    if (b !== null) blocks.push(b)
  }
  return blocks
}

function convertBlock(node: BlockContent | DefinitionContent): MarkdownAstBlock | null {
  switch (node.type) {
    case 'definition':
    case 'footnoteDefinition':
      return null
    case 'heading': {
      const depthRaw = node.depth
      const depth =
        depthRaw >= 1 && depthRaw <= 6 ? (depthRaw as 1 | 2 | 3 | 4 | 5 | 6) : 6
      return {
        type: 'heading',
        depth,
        children: convertPhrasing(node.children)
      }
    }
    case 'paragraph':
      return {
        type: 'paragraph',
        children: convertPhrasing(node.children)
      }
    case 'thematicBreak':
      return { type: 'thematicBreak' }
    case 'blockquote':
      return {
        type: 'blockquote',
        children: convertBlocksWithoutDefinitions(node.children)
      }
    case 'list':
      return {
        type: 'list',
        ordered: Boolean(node.ordered),
        start: node.start ?? undefined,
        children: convertListChildren(node.children)
      }
    case 'code':
      return {
        type: 'codeBlock',
        lang: node.lang ?? undefined,
        value: node.value
      }
    case 'table':
      return convertTable(node)
    case 'html':
      return paragraphFromLiteral(stripHtmlTags(node.value))
    default:
      return paragraphFromLiteral(`[Unsupported block: ${node.type}]`)
  }
}

export function mdastRootToSpecOps(root: Root): MarkdownAstRoot {
  return {
    type: 'root',
    children: convertBlocksWithoutDefinitions(root.children)
  }
}
