/** SpeOps markdown AST — adapter-facing shape only (no mdast leak). */

export interface MarkdownAstRoot {
  readonly type: 'root'
  readonly children: readonly MarkdownAstBlock[]
}

export type MarkdownAst = MarkdownAstRoot

export type MarkdownAstBlock =
  | MarkdownHeadingBlock
  | MarkdownParagraphBlock
  | MarkdownThematicBreakBlock
  | MarkdownBlockquoteBlock
  | MarkdownListBlock
  | MarkdownCodeBlockBlock

export interface MarkdownHeadingBlock {
  readonly type: 'heading'
  readonly depth: 1 | 2 | 3 | 4 | 5 | 6
  readonly children: readonly MarkdownAstInline[]
}

export interface MarkdownParagraphBlock {
  readonly type: 'paragraph'
  readonly children: readonly MarkdownAstInline[]
}

export interface MarkdownThematicBreakBlock {
  readonly type: 'thematicBreak'
}

export interface MarkdownBlockquoteBlock {
  readonly type: 'blockquote'
  readonly children: readonly MarkdownAstBlock[]
}

export interface MarkdownListBlock {
  readonly type: 'list'
  readonly ordered: boolean
  readonly start: number | undefined
  readonly children: readonly MarkdownListItemBlock[]
}

export interface MarkdownListItemBlock {
  readonly type: 'listItem'
  readonly children: readonly MarkdownAstBlock[]
}

export interface MarkdownCodeBlockBlock {
  readonly type: 'codeBlock'
  readonly lang: string | undefined
  readonly value: string
}

export type MarkdownAstInline =
  | MarkdownTextInline
  | MarkdownEmphasisInline
  | MarkdownStrongInline
  | MarkdownInlineCodeInline
  | MarkdownLinkInline
  | MarkdownImageInline
  | MarkdownBreakInline

export interface MarkdownTextInline {
  readonly type: 'text'
  readonly value: string
}

export interface MarkdownEmphasisInline {
  readonly type: 'emphasis'
  readonly children: readonly MarkdownAstInline[]
}

export interface MarkdownStrongInline {
  readonly type: 'strong'
  readonly children: readonly MarkdownAstInline[]
}

export interface MarkdownInlineCodeInline {
  readonly type: 'inlineCode'
  readonly value: string
}

export interface MarkdownLinkInline {
  readonly type: 'link'
  readonly url: string
  readonly title: string | undefined
  readonly children: readonly MarkdownAstInline[]
}

export interface MarkdownImageInline {
  readonly type: 'image'
  readonly url: string
  readonly title: string | undefined
  readonly alt: string
}

export interface MarkdownBreakInline {
  readonly type: 'break'
}

/** Stable boundary codes for EH-01 / EH-05 / EH-06 results. */
export const MarkdownIssueCodes = {
  parse_failed: 'parse_failed',
  render_failed: 'render_failed',
  sanitize_failed: 'sanitize_failed'
} as const

export interface MarkdownParseIssue {
  readonly code: string
  readonly message: string
}

export type ParseMarkdownResult =
  | { readonly ok: true; readonly ast: MarkdownAst }
  | { readonly ok: false; readonly error: MarkdownParseIssue }

export interface MarkdownRenderIssue {
  readonly code: string
  readonly message: string
}

export type RenderMarkdownResult =
  | { readonly ok: true; readonly html: string }
  | { readonly ok: false; readonly error: MarkdownRenderIssue }
