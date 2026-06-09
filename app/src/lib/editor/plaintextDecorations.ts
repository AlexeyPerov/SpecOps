import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

const symbolDeco = Decoration.mark({ class: "cm-plaintext-symbol" });

export function shouldDecorateAsSymbol(ch: string): boolean {
  if (!ch.trim()) {
    return false;
  }
  // Treat letters/numbers from all languages as normal text; decorate punctuation/symbols only.
  return !/[\p{L}\p{N}]/u.test(ch);
}

export function createPlaintextSymbolDecorations() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.build(update.view);
        }
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const doc = view.state.doc;
        const visible = view.visibleRanges;
        let pos = 0;

        for (const { from, to } of visible) {
          pos = from;
          while (pos < to) {
            const ch = doc.sliceString(pos, pos + 1);
            if (ch && shouldDecorateAsSymbol(ch)) {
              builder.add(pos, pos + 1, symbolDeco);
            }
            pos += 1;
          }
        }

        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}
