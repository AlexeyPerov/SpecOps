import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { codePointAt, codePointSize, RangeSetBuilder } from "@codemirror/state";

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

        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          const iter = doc.iterRange(from, to);
          for (;;) {
            iter.next();
            if (iter.done) {
              break;
            }
            if (iter.lineBreak) {
              pos += iter.value.length;
              continue;
            }
            const chunk = iter.value;
            let i = 0;
            while (i < chunk.length) {
              const size = codePointSize(codePointAt(chunk, i));
              const ch = chunk.slice(i, i + size);
              if (shouldDecorateAsSymbol(ch)) {
                builder.add(pos, pos + size, symbolDeco);
              }
              pos += size;
              i += size;
            }
          }
        }

        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}
