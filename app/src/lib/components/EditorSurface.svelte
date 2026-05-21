<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
  import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
    indentMore,
    indentLess,
    redo,
    undo,
  } from "@codemirror/commands";
  import { markdown } from "@codemirror/lang-markdown";
  import { EditorView, keymap, lineNumbers } from "@codemirror/view";
  import { appState } from "../state/appState";
  import type { EditorCommandRunner } from "../types/editor";

  let hostEl: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  const lineWrapCompartment = new Compartment();
  const fontSizeCompartment = new Compartment();
  let muted = false;

  export let content = "";
  export let wrapLines = false;
  export let zoomPercent = 100;
  export let onStatusMessage: (message: string) => void = () => {};
  export let onDocumentDirty: (nextContent: string) => void = () => {};
  export let registerEditorCommandRunner: ((runner: EditorCommandRunner) => void) | undefined =
    undefined;

  function withEditorSelection(
    transform: (text: string, from: number, to: number) => {
      text: string;
      from: number;
      to: number;
      message?: string;
    },
  ): void {
    if (!view) {
      return;
    }
    const state = view.state;
    const range = state.selection.main;
    const result = transform(state.doc.toString(), range.from, range.to);
    view.dispatch({
      changes: { from: 0, to: state.doc.length, insert: result.text },
      selection: EditorSelection.range(result.from, result.to),
      userEvent: "input",
    });
    if (result.message) {
      onStatusMessage(result.message);
    }
  }

  function lineRange(text: string, from: number, to: number): { start: number; end: number } {
    const lineStart = text.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
    const afterTo = to === text.length ? text.length : to + 1;
    const nextBreak = text.indexOf("\n", afterTo);
    const lineEnd = nextBreak === -1 ? text.length : nextBreak;
    return { start: lineStart, end: lineEnd };
  }

  function moveLine(direction: "up" | "down"): void {
    withEditorSelection((text, from, to) => {
      const current = lineRange(text, from, to);
      const currentLine = text.slice(current.start, current.end);
      if (direction === "up") {
        if (current.start === 0) {
          return { text, from, to, message: "Already at first line" };
        }
        const prevEnd = current.start - 1;
        const prevStart = text.lastIndexOf("\n", Math.max(0, prevEnd - 1)) + 1;
        const previous = text.slice(prevStart, prevEnd);
        const rebuilt = `${text.slice(0, prevStart)}${currentLine}\n${previous}${text.slice(current.end)}`;
        const delta = currentLine.length - previous.length;
        return {
          text: rebuilt,
          from: from - (previous.length + 1),
          to: to - (previous.length + 1),
          message: "Moved line up",
        };
      }

      if (current.end === text.length) {
        return { text, from, to, message: "Already at last line" };
      }

      const nextStart = current.end + 1;
      const nextEndRaw = text.indexOf("\n", nextStart);
      const nextEnd = nextEndRaw === -1 ? text.length : nextEndRaw;
      const nextLine = text.slice(nextStart, nextEnd);
      const rebuilt = `${text.slice(0, current.start)}${nextLine}\n${currentLine}${text.slice(nextEnd)}`;
      return {
        text: rebuilt,
        from: from + (nextLine.length + 1),
        to: to + (nextLine.length + 1),
        message: "Moved line down",
      };
    });
  }

  function duplicateLine(): void {
    withEditorSelection((text, from, to) => {
      const current = lineRange(text, from, to);
      const currentLine = text.slice(current.start, current.end);
      const insertAt = current.end;
      const separator = insertAt === text.length ? "\n" : "";
      const rebuilt = `${text.slice(0, insertAt)}\n${currentLine}${separator}${text.slice(insertAt)}`;
      return {
        text: rebuilt,
        from,
        to,
        message: "Duplicated line",
      };
    });
  }

  function joinLines(): void {
    withEditorSelection((text, from, to) => {
      const current = lineRange(text, from, to);
      const nextBreak = text.indexOf("\n", current.end + 1);
      if (current.end >= text.length || nextBreak === -1) {
        return { text, from, to, message: "Nothing to join" };
      }
      const rebuilt = `${text.slice(0, current.end)} ${text.slice(current.end + 1)}`;
      return {
        text: rebuilt,
        from,
        to,
        message: "Joined lines",
      };
    });
  }

  function updateCursor(): void {
    if (!view) {
      return;
    }
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    appState.setCursor(line.number, pos - line.from + 1);
  }

  function applyWrap(nextWrap: boolean): void {
    if (!view) {
      return;
    }
    view.dispatch({
      effects: lineWrapCompartment.reconfigure(
        nextWrap ? EditorView.lineWrapping : [],
      ),
    });
  }

  function applyZoom(nextZoom: number): void {
    if (!view) {
      return;
    }
    const px = Math.round((13 * nextZoom) / 100);
    view.dispatch({
      effects: fontSizeCompartment.reconfigure(
        EditorView.theme({
          "&": {
            fontSize: `${px}px`,
          },
        }),
      ),
    });
  }

  function normalizeForSearch(value: string, caseSensitive: boolean): string {
    return caseSensitive ? value : value.toLowerCase();
  }

  function findNext(query: string, caseSensitive: boolean): boolean {
    if (!view || query.length === 0) {
      return false;
    }
    const doc = view.state.doc.toString();
    const haystack = normalizeForSearch(doc, caseSensitive);
    const needle = normalizeForSearch(query, caseSensitive);
    const from = view.state.selection.main.to;
    let idx = haystack.indexOf(needle, from);
    if (idx === -1) {
      idx = haystack.indexOf(needle, 0);
    }
    if (idx === -1) {
      return false;
    }
    view.dispatch({
      selection: EditorSelection.range(idx, idx + query.length),
      scrollIntoView: true,
    });
    updateCursor();
    return true;
  }

  function replaceCurrent(
    query: string,
    replacement: string,
    caseSensitive: boolean,
  ): boolean {
    if (!view || query.length === 0) {
      return false;
    }
    const sel = view.state.selection.main;
    const selectedText = view.state.sliceDoc(sel.from, sel.to);
    if (
      normalizeForSearch(selectedText, caseSensitive) !==
      normalizeForSearch(query, caseSensitive)
    ) {
      return false;
    }
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: replacement },
      selection: EditorSelection.range(sel.from, sel.from + replacement.length),
      userEvent: "input",
    });
    return true;
  }

  function replaceAll(
    query: string,
    replacement: string,
    caseSensitive: boolean,
  ): number {
    if (!view || query.length === 0) {
      return 0;
    }
    const source = view.state.doc.toString();
    const haystack = normalizeForSearch(source, caseSensitive);
    const needle = normalizeForSearch(query, caseSensitive);
    let index = 0;
    let count = 0;
    const changes: { from: number; to: number; insert: string }[] = [];
    while (index <= haystack.length) {
      const found = haystack.indexOf(needle, index);
      if (found === -1) break;
      changes.push({ from: found, to: found + query.length, insert: replacement });
      count += 1;
      index = found + Math.max(1, query.length);
    }
    if (changes.length > 0) {
      view.dispatch({ changes, userEvent: "input" });
      updateCursor();
    }
    return count;
  }

  function goToLine(line: number): boolean {
    if (!view || !Number.isFinite(line) || line < 1) {
      return false;
    }
    const clampedLine = Math.min(line, view.state.doc.lines);
    const target = view.state.doc.line(clampedLine);
    view.dispatch({
      selection: EditorSelection.cursor(target.from),
      scrollIntoView: true,
    });
    updateCursor();
    return true;
  }

  onMount(() => {
    if (!hostEl) {
      return;
    }

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        lineWrapCompartment.of([]),
        fontSizeCompartment.of(
          EditorView.theme({
            "&": {
              fontSize: "13px",
            },
          }),
        ),
        markdown(),
        EditorView.theme({
          "&": {
            height: "100%",
            fontFamily: "var(--font-family-ui)",
            color: "var(--color-text-primary)",
            backgroundColor: "var(--color-surface-1)",
          },
          ".cm-content, .cm-gutter": {
            minHeight: "100%",
          },
          ".cm-gutters": {
            backgroundColor: "var(--color-surface-1)",
            color: "var(--color-text-secondary)",
            borderRight: "1px solid var(--color-border-subtle)",
          },
          "&.cm-focused": {
            outline: "2px solid var(--color-focus-ring)",
            outlineOffset: "-2px",
          },
          ".cm-activeLine, .cm-activeLineGutter": {
            backgroundColor: "var(--color-hover)",
          },
          ".cm-cursor, .cm-dropCursor": {
            borderLeftColor: "var(--color-text-primary)",
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !muted) {
            onDocumentDirty(update.state.doc.toString());
          }
          if (update.selectionSet) {
            updateCursor();
          }
        }),
      ],
    });

    view = new EditorView({
      state,
      parent: hostEl,
    });

    applyWrap(wrapLines);
    applyZoom(zoomPercent);
    updateCursor();

    registerEditorCommandRunner?.({
      undo: () => {
        if (!view) return;
        undo(view);
      },
      redo: () => {
        if (!view) return;
        redo(view);
      },
      indent: () => {
        if (!view) return;
        indentMore(view);
      },
      outdent: () => {
        if (!view) return;
        indentLess(view);
      },
      moveLineUp: () => moveLine("up"),
      moveLineDown: () => moveLine("down"),
      duplicateLine,
      joinLines,
      setWrap: (value) => applyWrap(value),
      setZoom: (zoom) => applyZoom(zoom),
      findNext,
      replaceCurrent,
      replaceAll,
      goToLine,
    });
  });

  onDestroy(() => {
    view?.destroy();
  });

  $: if (view && wrapLines !== undefined) {
    applyWrap(wrapLines);
  }

  $: if (view && zoomPercent) {
    applyZoom(zoomPercent);
  }

  $: if (view && content !== view.state.doc.toString()) {
    muted = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
    muted = false;
  }
</script>

<div bind:this={hostEl} class="editor-host"></div>

<style>
  .editor-host {
    height: 100%;
    border-radius: var(--radius-md);
    overflow: hidden;
    border: 1px solid var(--color-border-subtle);
  }
</style>
