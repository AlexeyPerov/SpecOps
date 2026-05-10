/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Preview renderer: `html` (default) or `astJson` (AST JSON in `<pre>`). */
  readonly VITE_MARKDOWN_RENDERER?: string
}
