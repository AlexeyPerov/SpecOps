import { EditorState, Transaction } from "@codemirror/state";
const content = "line one\r\nline two\r\nline three";
let state = EditorState.create({ doc: content, selection: {anchor: 12, head: 12} });
console.log("mismatch on open:", content !== state.doc.toString());
const tr = state.update({
  changes: { from: 0, to: state.doc.length, insert: content },
  annotations: [Transaction.addToHistory.of(false)],
});
console.log("docChanged:", tr.docChanged, "| cursor before 12 -> after", tr.state.selection.main.head);
console.log("still mismatched after apply:", content !== tr.state.doc.toString());
