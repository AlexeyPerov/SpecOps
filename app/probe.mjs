import { EditorState, Text } from "@codemirror/state";
import { RegExpCursor } from "@codemirror/search";

// 1) CRLF: does EditorState.create strip \r?
const s = EditorState.create({ doc: "a\r\nb\r\nc" });
console.log("doc.toString() ===", JSON.stringify(s.doc.toString()));
console.log("lineBreak =", JSON.stringify(s.lineBreak));
console.log("content prop === doc.toString()?", "a\r\nb\r\nc" === s.doc.toString());

// after a full replace with the CRLF string, does it stay unequal?
const tr = s.update({ changes: { from: 0, to: s.doc.length, insert: "a\r\nb\r\nc" } });
console.log("after replace, doc =", JSON.stringify(tr.state.doc.toString()));
console.log("selection mapped from 0:", JSON.stringify(tr.state.selection.main));

// 2) selection mapping on full-doc replace
const s2 = EditorState.create({ doc: "hello\nworld\nagain" , selection: {anchor: 2, head: 2}});
const tr2 = s2.update({ changes: { from: 0, to: s2.doc.length, insert: "hello\nworld\nagain!" } });
console.log("cursor after full replace:", tr2.state.selection.main.head, "docLen", tr2.state.doc.length);

// 3) find-next wrap off-by-one: single match, cursor after it
const doc = Text.of(["abc"]);
function findNextRange(doc, source, from) {
  let cursor = new RegExpCursor(doc, source, {ignoreCase:true}, from);
  if (!cursor.next().done) return {from: cursor.value.from, to: cursor.value.to, pass: "forward"};
  cursor = new RegExpCursor(doc, source, {ignoreCase:true}, 0, from > 0 ? from - 1 : 0);
  if (!cursor.next().done) return {from: cursor.value.from, to: cursor.value.to, pass: "wrap"};
  return null;
}
console.log("find 'abc' from 3 (whole doc selected):", findNextRange(doc, "abc", 3));
const doc2 = Text.of(["xx","abc","yy"]);
console.log("find 'abc' from 6 (multi-line, match selected):", findNextRange(doc2, "abc", 6));
