/**
 * Imperative CodeMirror view controller.
 * Owns EditorView create/destroy, document switching, content sync, scroll
 * ownership, and generation-aware language loads. Svelte only bridges props.
 */
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { EditorHostRegistration } from "../types/editor";
import type { EditorDocumentSessionCache } from "./editorDocumentSessionCache";
import {
  applyWrap,
  applyZoom,
  buildEditorExtensions,
  createEditorExtensionCompartments,
} from "./editorExtensions";
import { createEditorHost } from "./editorHostFactory";
import {
  getLanguageSupport,
  loadLanguageSupport,
  type EditorLanguageId,
} from "./editorLanguage";
import { minimapExtension } from "./editorMinimap";
import { foldExtension } from "./editorFold";
import { createPlaintextSymbolDecorations } from "./plaintextDecorations";
import {
  storeOriginAnnotation,
  transactionHasStoreOrigin,
} from "./editorTransactions";
import type { EditorWorkbenchRuntime } from "./editorWorkbenchRuntime";

export type EditorViewControllerProps = {
  content: string;
  documentId: string | null;
  paneId: string;
  scrollTop: number;
  wrapLines: boolean;
  zoomPercent: number;
  language: EditorLanguageId;
  decoratePlaintextSymbols: boolean;
  showMinimap: boolean;
  showFoldGutter: boolean;
};

export type EditorViewControllerDeps = {
  workbench: EditorWorkbenchRuntime;
  sessionCache: EditorDocumentSessionCache;
  onStatusMessage: (message: string) => void;
  onDocumentDirty: (nextContent: string) => void;
  onScrollTopChange: (documentId: string, scrollTop: number) => void;
};

export type EditorViewController = {
  mount: (parent: HTMLElement) => void;
  update: (props: EditorViewControllerProps) => void;
  destroy: () => void;
  getView: () => EditorView | undefined;
  /** Test/diagnostics: current tracked document id. */
  getTrackedDocumentId: () => string | null;
  /** Test/diagnostics: current document generation. */
  getDocumentGeneration: () => number;
  /** Test/diagnostics: instance-owned extension compartments. */
  getCompartments: () => ReturnType<typeof createEditorExtensionCompartments>;
};

const SCROLL_SAVE_DEBOUNCE_MS = 150;

export function createEditorViewController(
  deps: EditorViewControllerDeps,
): EditorViewController {
  const compartments = createEditorExtensionCompartments();

  let view: EditorView | undefined;
  let destroyed = false;
  let mounted = false;
  let props: EditorViewControllerProps | null = null;

  let trackedDocumentId: string | null = null;
  let documentGeneration = 0;
  let languageLoadGeneration = 0;
  let currentEditorLanguage: EditorLanguageId = "plaintext";
  let lastDecoKey = "";
  let lastMinimapEnabled: boolean | null = null;
  let lastFoldGutterEnabled: boolean | null = null;

  let applyingScroll = false;
  let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let detachScrollListener: (() => void) | null = null;

  let hostGeneration = 0;
  let hostRegistration: EditorHostRegistration | null = null;

  function updateCursor(): void {
    if (!view || !hostRegistration) {
      return;
    }
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    deps.workbench.publishCursorStatus(
      hostRegistration.identity,
      line.number,
      pos - line.from + 1,
      view.state.selection.ranges.length,
    );
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
      scrollSaveTimer = null;
      if (destroyed) {
        return;
      }
      deps.onScrollTopChange(documentIdForSave, nextScrollTop);
    }, SCROLL_SAVE_DEBOUNCE_MS);
  }

  function flushScrollTopSave(force = false): void {
    if (!view || !trackedDocumentId || (!force && applyingScroll)) {
      return;
    }
    if (scrollSaveTimer) {
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = null;
    }
    deps.onScrollTopChange(trackedDocumentId, view.scrollDOM.scrollTop);
  }

  function attachScrollListener(): void {
    detachScrollListener?.();
    if (!view) {
      return;
    }
    const scroller = view.scrollDOM;
    const onScroll = (): void => {
      if (applyingScroll || !trackedDocumentId || destroyed) {
        return;
      }
      scheduleScrollTopSave(trackedDocumentId, scroller.scrollTop);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    detachScrollListener = () => {
      scroller.removeEventListener("scroll", onScroll);
    };
  }

  function unregisterHost(): void {
    hostRegistration?.unregister();
    hostRegistration = null;
  }

  function registerHost(): void {
    if (!view || !props) {
      return;
    }
    unregisterHost();
    hostGeneration += 1;
    const identity = {
      paneId: props.paneId,
      documentId: props.documentId,
      generation: hostGeneration,
    };
    const host = createEditorHost({
      identity,
      getView: () => (destroyed ? undefined : view),
      lineWrapCompartment: compartments.lineWrap,
      fontSizeCompartment: compartments.fontSize,
      searchHighlightCompartment: compartments.searchHighlight,
      onStatusMessage: deps.onStatusMessage,
      updateCursor,
      focus: () => {
        view?.focus();
      },
    });
    hostRegistration = deps.workbench.registerHost(host);
  }

  function buildExtensions(
    language: EditorLanguageId,
    showMinimap: boolean,
    showFoldGutter: boolean,
  ) {
    return buildEditorExtensions({
      compartments,
      language,
      showMinimap,
      showFoldGutter,
      updateListener: EditorView.updateListener.of((update) => {
        if (destroyed) {
          return;
        }
        if (update.docChanged && !transactionHasStoreOrigin(update.transactions)) {
          deps.onDocumentDirty(update.state.doc.toString());
        }
        if (update.selectionSet) {
          updateCursor();
        }
      }),
    });
  }

  function createState(
    content: string,
    language: EditorLanguageId,
    showMinimap: boolean,
    showFoldGutter: boolean,
  ): EditorState {
    return EditorState.create({
      doc: content,
      extensions: buildExtensions(language, showMinimap, showFoldGutter),
    });
  }

  function saveOutgoingSession(): void {
    if (!view || !trackedDocumentId || !props) {
      return;
    }
    deps.sessionCache.save(
      { paneId: props.paneId, documentId: trackedDocumentId },
      view.state,
    );
  }

  function restoreOrCreateState(
    documentId: string | null,
    content: string,
    language: EditorLanguageId,
    showMinimap: boolean,
    showFoldGutter: boolean,
  ): EditorState {
    if (!documentId || !props) {
      return createState(content, language, showMinimap, showFoldGutter);
    }
    const cached = deps.sessionCache.take({
      paneId: props.paneId,
      documentId,
    });
    // Never resurrect pre-reload content from a stale cached session.
    if (cached && cached.doc.toString() === content) {
      return cached;
    }
    return createState(content, language, showMinimap, showFoldGutter);
  }

  function syncLanguage(language: EditorLanguageId): void {
    if (!view || language === currentEditorLanguage) {
      return;
    }
    currentEditorLanguage = language;
    languageLoadGeneration += 1;
    const loadGeneration = languageLoadGeneration;
    const docGeneration = documentGeneration;
    const syncSupport = getLanguageSupport(language);
    if (syncSupport) {
      view.dispatch({
        effects: compartments.language.reconfigure(syncSupport),
      });
    }
    void loadLanguageSupport(language).then((support) => {
      if (
        destroyed ||
        !view ||
        loadGeneration !== languageLoadGeneration ||
        docGeneration !== documentGeneration
      ) {
        return;
      }
      view.dispatch({
        effects: compartments.language.reconfigure(support ?? []),
      });
    });
  }

  function syncDecorations(
    language: EditorLanguageId,
    decoratePlaintextSymbols: boolean,
  ): void {
    if (!view) {
      return;
    }
    const key = `${language}:${decoratePlaintextSymbols}`;
    if (key === lastDecoKey) {
      return;
    }
    lastDecoKey = key;
    const shouldDecorate = language === "plaintext" && decoratePlaintextSymbols;
    view.dispatch({
      effects: compartments.decoration.reconfigure(
        shouldDecorate ? [createPlaintextSymbolDecorations()] : [],
      ),
    });
  }

  function syncMinimap(showMinimap: boolean): void {
    if (!view || showMinimap === lastMinimapEnabled) {
      return;
    }
    lastMinimapEnabled = showMinimap;
    view.dispatch({
      effects: compartments.minimap.reconfigure(minimapExtension(showMinimap)),
    });
  }

  function syncFoldGutter(showFoldGutter: boolean): void {
    if (!view || showFoldGutter === lastFoldGutterEnabled) {
      return;
    }
    lastFoldGutterEnabled = showFoldGutter;
    view.dispatch({
      effects: compartments.fold.reconfigure(
        foldExtension({ showGutter: showFoldGutter }),
      ),
    });
  }

  function applyExternalContent(content: string, kind: "sync" | "reload"): void {
    if (!view || content === view.state.doc.toString()) {
      return;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      annotations: [
        storeOriginAnnotation.of(kind),
        Transaction.addToHistory.of(false),
      ],
    });
  }

  function switchDocument(next: EditorViewControllerProps): void {
    if (!view) {
      return;
    }
    flushScrollTopSave(true);
    saveOutgoingSession();

    documentGeneration += 1;
    languageLoadGeneration += 1;

    const nextState = restoreOrCreateState(
      next.documentId,
      next.content,
      next.language,
      next.showMinimap,
      next.showFoldGutter,
    );
    view.setState(nextState);

    trackedDocumentId = next.documentId;
    // Force language/decoration/minimap/fold reconfigure against possibly restored state.
    currentEditorLanguage = "" as EditorLanguageId;
    lastDecoKey = "";
    lastMinimapEnabled = null;
    lastFoldGutterEnabled = null;

    // Re-apply pane-level chrome that may differ from a restored session.
    applyWrap(view, compartments.lineWrap, next.wrapLines);
    applyZoom(view, compartments.fontSize, next.zoomPercent);
    syncLanguage(next.language);
    syncDecorations(next.language, next.decoratePlaintextSymbols);
    syncMinimap(next.showMinimap);
    syncFoldGutter(next.showFoldGutter);
    applyScrollTop(next.scrollTop);
    registerHost();
    updateCursor();
  }

  function mount(parent: HTMLElement): void {
    if (destroyed || mounted) {
      return;
    }
    mounted = true;
    const initial = props ?? {
      content: "",
      documentId: null,
      paneId: "",
      scrollTop: 0,
      wrapLines: false,
      zoomPercent: 100,
      language: "plaintext" as EditorLanguageId,
      decoratePlaintextSymbols: true,
      showMinimap: true,
      showFoldGutter: true,
    };

    const state = createState(
      initial.content,
      initial.language,
      initial.showMinimap,
      initial.showFoldGutter,
    );
    view = new EditorView({ state, parent });

    applyWrap(view, compartments.lineWrap, initial.wrapLines);
    applyZoom(view, compartments.fontSize, initial.zoomPercent);
    attachScrollListener();
    trackedDocumentId = initial.documentId;
    currentEditorLanguage = "" as EditorLanguageId;
    lastMinimapEnabled = null;
    lastFoldGutterEnabled = null;
    documentGeneration = 1;
    applyScrollTop(initial.scrollTop);
    syncLanguage(initial.language);
    syncDecorations(initial.language, initial.decoratePlaintextSymbols);
    syncMinimap(initial.showMinimap);
    syncFoldGutter(initial.showFoldGutter);
    registerHost();
    updateCursor();
  }

  function update(next: EditorViewControllerProps): void {
    if (destroyed) {
      return;
    }
    const previous = props;
    props = next;

    if (!mounted || !view) {
      return;
    }

    if (!previous) {
      return;
    }

    if (next.documentId !== trackedDocumentId) {
      switchDocument(next);
      return;
    }

    // Same document: external/store content sync (no dirty feedback).
    if (next.content !== view.state.doc.toString()) {
      applyExternalContent(next.content, "reload");
    }

    applyWrap(view, compartments.lineWrap, next.wrapLines);
    if (next.zoomPercent) {
      applyZoom(view, compartments.fontSize, next.zoomPercent);
    }
    syncLanguage(next.language);
    syncDecorations(next.language, next.decoratePlaintextSymbols);
    syncMinimap(next.showMinimap);
    syncFoldGutter(next.showFoldGutter);

    // Scroll from store only when document identity is unchanged and the
    // prop changed externally (e.g. restore). Avoid fighting user scroll.
    if (next.scrollTop !== previous.scrollTop && !applyingScroll) {
      const current = view.scrollDOM.scrollTop;
      if (Math.abs(current - next.scrollTop) > 1) {
        applyScrollTop(next.scrollTop);
      }
    }

    // paneId changes are unusual; re-register if needed.
    if (next.paneId !== previous.paneId) {
      registerHost();
    }
  }

  function destroy(): void {
    if (destroyed) {
      return;
    }
    destroyed = true;
    flushScrollTopSave(true);
    // Cached EditorStates bind to this controller's Compartment instances.
    // Drop pane sessions on teardown so a remount cannot restore incompatible state.
    if (props?.paneId) {
      deps.sessionCache.invalidatePane(props.paneId);
    }
    if (scrollSaveTimer) {
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = null;
    }
    detachScrollListener?.();
    detachScrollListener = null;
    unregisterHost();
    view?.destroy();
    view = undefined;
    languageLoadGeneration += 1;
    documentGeneration += 1;
  }

  return {
    mount,
    update,
    destroy,
    getView: () => (destroyed ? undefined : view),
    getTrackedDocumentId: () => trackedDocumentId,
    getDocumentGeneration: () => documentGeneration,
    getCompartments: () => compartments,
  };
}
