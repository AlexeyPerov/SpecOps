/** Normalized markdown tree (extended in later tasks). */

export interface MarkdownAst {
  readonly type: 'root'
  readonly children: readonly MarkdownAstBlock[]
}

export type MarkdownAstBlock = MarkdownParagraphBlock

export interface MarkdownParagraphBlock {
  readonly type: 'paragraph'
  readonly text: string
}

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
