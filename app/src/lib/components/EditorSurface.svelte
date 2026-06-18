<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Compartment, EditorState } from "@codemirror/state";
  import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
  } from "@codemirror/commands";
  import { EditorView, keymap, lineNumbers } from "@codemirror/view";
  import { appState } from "../state/appState";
  import type { EditorCommandRunner } from "../types/editor";
  import { createSyntaxHighlightExtension } from "../editor/editorHighlight";
  import { getLanguageSupport, loadLanguageSupport } from "../editor/editorLanguage";
  import type { EditorLanguageId } from "../editor/editorLanguage";
  import { createPlaintextSymbolDecorations } from "../editor/plaintextDecorations";
  import {
    applyWrap,
    applyZoom,
    createEditorCommandRunner,
  } from "../editor/editorCommandRunner";
  import { searchHighlightCompartment } from "../editor/searchHighlight";

  interface Props {
    content?: string;
    documentId?: string | null;
    scrollTop?: number;
    wrapLines?: boolean;
    zoomPercent?: number;
    language?: EditorLanguageId;
    decoratePlaintextSymbols?: boolean;
    onStatusMessage?: (message: string) => void;
    onDocumentDirty?: (nextContent: string) => void;
    onScrollTopChange?: (documentId: string, scrollTop: number) => void;
    registerEditorCommandRunner?: ((runner: EditorCommandRunner) => void) | undefined;
  }

  let {
    content = "",
    documentId = null,
    scrollTop = 0,
    wrapLines = false,
    zoomPercent = 100,
    language = "plaintext",
    decoratePlaintextSymbols = true,
    onStatusMessage = () => {},
    onDocumentDirty = () => {},
    onScrollTopChange = () => {},
    registerEditorCommandRunner = undefined,
  }: Props = $props();

  let hostEl = $state<HTMLDivElement | undefined>(undefined);
  let view = $state<EditorView | undefined>(undefined);
  const lineWrapCompartment = new Compartment();
  const fontSizeCompartment = new Compartment();
  const languageCompartment = new Compartment();
  const highlightCompartment = new Compartment();
  const decorationCompartment = new Compartment();
  let muted = $state(false);

  let trackedDocumentId = $state<string | null>(null);
  let currentEditorLanguage = $state<EditorLanguageId>("plaintext");
  let lastDecoState = $state("");
  let applyingScroll = $state(false);
  let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let detachScrollListener: (() => void) | null = null;

  function updateCursor(): void {
    if (!view) {
      return;
    }
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    appState.setCursor(line.number, pos - line.from + 1);
  }

  function applyScrollTop(nextScrollTop: number): void {
    if (!view) {
      return;
    }
    applyingScroll = true;
    view.scrollDOM.scrollTop = nextScrollTop;
    requestAnimationFrame(() => {
      applyingScroll = false;
    });
  }

  function scheduleScrollTopSave(documentIdForSave: string, nextScrollTop: number): void {
    if (scrollSaveTimer) {
      clearTimeout(scrollSaveTimer);
    }
    scrollSaveTimer = setTimeout(() => {
      onScrollTopChange(documentIdForSave, nextScrollTop);
    }, 150);
  }

  function flushScrollTopSave(): void {
    if (!view || !trackedDocumentId || applyingScroll) {
      return;
    }
    if (scrollSaveTimer) {
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = null;
    }
    onScrollTopChange(trackedDocumentId, view.scrollDOM.scrollTop);
  }

  function attachScrollListener(): void {
    detachScrollListener?.();
    if (!view) {
      return;
    }
    const scroller = view.scrollDOM;
    const onScroll = (): void => {
      if (applyingScroll || !trackedDocumentId) {
        return;
      }
      scheduleScrollTopSave(trackedDocumentId, scroller.scrollTop);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    detachScrollListener = () => {
      scroller.removeEventListener("scroll", onScroll);
    };
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
              fontSize: "var(--font-size-editor, 13px)",
            },
          }),
        ),
        languageCompartment.of(getLanguageSupport(language) ?? []),
        highlightCompartment.of(createSyntaxHighlightExtension()),
        decorationCompartment.of([]),
        searchHighlightCompartment.of([]),
        EditorView.theme({
          "&": {
            height: "100%",
            width: "100%",
            maxWidth: "100%",
            fontFamily: "var(--font-family-ui)",
            color: "var(--color-text-primary)",
            backgroundColor: "var(--color-surface-1)",
          },
          ".cm-content, .cm-gutter": {
            minHeight: "100%",
          },
          ".cm-content": {
            caretColor: "var(--color-text-primary)",
          },
          ".cm-gutters": {
            backgroundColor: "var(--color-surface-1)",
            color: "var(--color-text-secondary)",
            borderRight: "1px solid var(--color-border-subtle)",
          },
          "&.cm-focused": {
            outline: "none",
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

    applyWrap(view, lineWrapCompartment, wrapLines);
    applyZoom(view, fontSizeCompartment, zoomPercent);
    updateCursor();
    attachScrollListener();
    trackedDocumentId = documentId;
    currentEditorLanguage = language;
    applyScrollTop(scrollTop);

    registerEditorCommandRunner?.(
      createEditorCommandRunner({
        getView: () => view,
        lineWrapCompartment,
        fontSizeCompartment,
        searchHighlightCompartment,
        onStatusMessage,
        updateCursor,
      }),
    );
  });

  onDestroy(() => {
    flushScrollTopSave();
    if (scrollSaveTimer) {
      clearTimeout(scrollSaveTimer);
    }
    detachScrollListener?.();
    view?.destroy();
  });

  $effect(() => {
    if (!view || documentId === trackedDocumentId) {
      return;
    }
    flushScrollTopSave();
    trackedDocumentId = documentId;
    applyScrollTop(scrollTop);
  });

  $effect(() => {
    if (!view) {
      return;
    }
    applyWrap(view, lineWrapCompartment, wrapLines);
  });

  $effect(() => {
    if (!view || !zoomPercent) {
      return;
    }
    applyZoom(view, fontSizeCompartment, zoomPercent);
  });

  $effect(() => {
    if (!view || content === view.state.doc.toString()) {
      return;
    }
    muted = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
    muted = false;
  });

  $effect(() => {
    if (!view || language === undefined || language === currentEditorLanguage) {
      return;
    }
    currentEditorLanguage = language;
    void loadLanguageSupport(language).then((support) => {
      if (view) {
        view.dispatch({
          effects: languageCompartment.reconfigure(support ?? []),
        });
      }
    });
  });

  $effect(() => {
    if (!view) {
      return;
    }
    const key = `${language}:${decoratePlaintextSymbols}`;
    if (key !== lastDecoState) {
      lastDecoState = key;
      const shouldDecorate = language === "plaintext" && decoratePlaintextSymbols;
      view.dispatch({
        effects: decorationCompartment.reconfigure(
          shouldDecorate ? [createPlaintextSymbolDecorations()] : [],
        ),
      });
    }
  });
</script>

<div bind:this={hostEl} class="editor-host"></div>

<style>
  .editor-host {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border-radius: var(--radius-md);
    overflow: hidden;
    border: 1px solid var(--color-border-subtle);
  }
</style>
