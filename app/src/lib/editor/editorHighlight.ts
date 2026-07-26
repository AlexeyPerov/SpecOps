import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";

function readCSSVar(name: string): string {
  if (typeof document === "undefined") {
    return "#888";
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

/**
 * A `HighlightStyle` is a `StyleModule`: mounting it inserts one CSS rule per
 * tag into the document and nothing ever removes them. Defining it per
 * `EditorState` (once per document open, plus once per tab switch) therefore
 * grows the CSSOM without bound for the whole session. The style is
 * value-independent — every colour is a CSS variable resolved at paint time, so
 * theme switches need no rebuild — so it is built once and shared.
 */
let highlightStyle: HighlightStyle | null = null;
let syntaxHighlightExtension: Extension | null = null;

function buildHighlightStyle(): HighlightStyle {
  return HighlightStyle.define([
    { tag: tags.keyword, color: "var(--syntax-keyword)" },
    { tag: tags.string, color: "var(--syntax-string)" },
    { tag: tags.comment, color: "var(--syntax-comment)" },
    { tag: tags.number, color: "var(--syntax-number)" },
    { tag: tags.typeName, color: "var(--syntax-type)" },
    { tag: tags.heading1, color: "var(--syntax-heading)", fontWeight: "700" },
    { tag: tags.heading2, color: "var(--syntax-heading)", fontWeight: "700" },
    { tag: tags.heading3, color: "var(--syntax-heading)", fontWeight: "700" },
    { tag: tags.heading4, color: "var(--syntax-heading)", fontWeight: "600" },
    { tag: tags.heading5, color: "var(--syntax-heading)", fontWeight: "600" },
    { tag: tags.heading6, color: "var(--syntax-heading)", fontWeight: "600" },
    { tag: tags.link, color: "var(--syntax-link)" },
    { tag: tags.url, color: "var(--syntax-link)" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strong, fontWeight: "700" },
    { tag: tags.strikethrough, textDecoration: "line-through" },
    { tag: tags.monospace, color: "var(--syntax-markup)" },
    { tag: tags.quote, color: "var(--syntax-comment)" },
    { tag: tags.meta, color: "var(--syntax-comment)" },
    { tag: tags.processingInstruction, color: "var(--syntax-markup)" },
    { tag: tags.punctuation, color: "var(--syntax-punctuation)" },
    { tag: tags.operator, color: "var(--syntax-punctuation)" },
    { tag: tags.variableName, color: "var(--syntax-punctuation)" },
    { tag: tags.propertyName, color: "var(--syntax-type)" },
    { tag: tags.function(tags.variableName), color: "var(--syntax-link)" },
    { tag: tags.definition(tags.variableName), color: "var(--syntax-link)" },
    { tag: tags.bool, color: "var(--syntax-number)" },
    { tag: tags.null, color: "var(--syntax-number)" },
    { tag: tags.className, color: "var(--syntax-type)" },
    { tag: tags.labelName, color: "var(--syntax-type)" },
    { tag: tags.separator, color: "var(--syntax-punctuation)" },
  ]);
}

export function createSyntaxHighlightExtension(): Extension {
  highlightStyle ??= buildHighlightStyle();
  syntaxHighlightExtension ??= syntaxHighlighting(highlightStyle);
  return syntaxHighlightExtension;
}
