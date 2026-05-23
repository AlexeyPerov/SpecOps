import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";

function readCSSVar(name: string): string {
  if (typeof document === "undefined") {
    return "#888";
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

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

export function createSyntaxHighlightExtension() {
  return syntaxHighlighting(buildHighlightStyle());
}
