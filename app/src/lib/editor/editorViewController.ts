/**
 * Imperative CodeMirror view controller.
 * Owns EditorView create/destroy, document switching, content sync, scroll
 * ownership, and generation-aware language loads. Svelte only bridges props.
 */
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { EditorHostRegistration } from "../types/editor";
import {
  sessionKeyId,
  type EditorDocumentSessionCache,
  type EditorSessionKey,
} from "./editorDocumentSessionCache";
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
import { foldGutterExtension } from "./editorFold";
import { completionExtension } from "./editorCompletion";
import {
  createSnippetCompletionSource,
  snippetCatalogKey,
  snippetExtension,
} from "./editorSnippets";
import type { ResolvedMarkdownSnippet } from "../domain/snippets";
import type { ContextId } from "../domain/contracts";
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
  /** Editor context id — namespaces the host identity and session cache so
   *  contexts with overlapping pane/document ids cannot collide when multiple
   *  editor trees stay mounted across a context switch. */
  contextId: ContextId;
  scrollTop: number;
  wrapLines: boolean;
  zoomPercent: number;
  language: EditorLanguageId;
  decoratePlaintextSymbols: boolean;
  showMinimap: boolean;
  showFoldGutter: boolean;
  autoClosePairs: boolean;
  autoSuggest: boolean;
  /** Enabled Markdown snippets for completion/insert (empty when not Markdown). */
  enabledSnippets: readonly ResolvedMarkdownSnippet[];
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
  /**
   * Re-measure layout after the host becomes visible again (e.g. keep-alive
   * tab slot leaving `display: none`). Without this, caret/gutter geometry can
   * stay stale until the next edit.
   */
  requestMeasure: () => void;
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
  // Sessions this controller has written to the cache. Cached EditorStates
  // bind to this controller's Compartment instances, so on destroy we
  // invalidate exactly these keys — not every pane/context that happens to
  // show the same documentId. With per-tab keep-alive, multiple controllers
  // share a pane; pane-level invalidation would wipe sibling undo/fold state.
  const cachedSessionKeys = new Map<string, EditorSessionKey>();
  let documentGeneration = 0;
  let languageLoadGeneration = 0;
  let currentEditorLanguage: EditorLanguageId = "plaintext";
  let lastDecoKey = "";
  let lastMinimapEnabled: boolean | null = null;
  let lastFoldGutterEnabled: boolean | null = null;
  let lastCompletionKey = "";
  let lastSnippetKey = "";
  let lastSnippetsEnabled: boolean | null = null;
  let lastWrapLines: boolean | null = null;
  let lastZoomPercent: number | null = null;

  let applyingScroll = false;
  let applyingScrollRaf: ReturnType<typeof requestAnimationFrame> | null = null;
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
    if (applyingScrollRaf !== null) {
      cancelAnimationFrame(applyingScrollRaf);
    }
    applyingScrollRaf = requestAnimationFrame(() => {
      applyingScrollRaf = null;
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
      contextId: props.contextId,
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
      getLanguage: () => currentEditorLanguage,
      findEnabledSnippet: (snippetId) =>
        (props?.enabledSnippets ?? []).find((entry) => entry.id === snippetId),
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
    autoClosePairs: boolean,
    autoSuggest: boolean,
    enabledSnippets: readonly ResolvedMarkdownSnippet[],
    wrapLines = false,
    zoomPercent = 100,
    decoratePlaintextSymbols = true,
  ) {
    const snippetSource =
      language === "markdown" && enabledSnippets.length > 0
        ? createSnippetCompletionSource(enabledSnippets)
        : null;
    return buildEditorExtensions({
      compartments,
      language,
      showMinimap,
      showFoldGutter,
      wrapLines,
      zoomPercent,
      decoratePlaintextSymbols,
      autoClosePairs,
      autoSuggest,
      snippetsEnabled: language === "markdown",
      snippetSource,
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
    autoClosePairs: boolean,
    autoSuggest: boolean,
    enabledSnippets: readonly ResolvedMarkdownSnippet[],
    wrapLines = false,
    zoomPercent = 100,
    decoratePlaintextSymbols = true,
  ): EditorState {
    return EditorState.create({
      doc: content,
      extensions: buildExtensions(
        language,
        showMinimap,
        showFoldGutter,
        autoClosePairs,
        autoSuggest,
        enabledSnippets,
        wrapLines,
        zoomPercent,
        decoratePlaintextSymbols,
      ),
    });
  }

  function saveOutgoingSession(): void {
    if (!view || !trackedDocumentId || !props) {
      return;
    }
    const key: EditorSessionKey = {
      contextId: props.contextId,
      paneId: props.paneId,
      documentId: trackedDocumentId,
    };
    deps.sessionCache.save(key, view.state);
    cachedSessionKeys.set(sessionKeyId(key), key);
  }

  function restoreOrCreateState(
    documentId: string | null,
    content: string,
    language: EditorLanguageId,
    showMinimap: boolean,
    showFoldGutter: boolean,
    autoClosePairs: boolean,
    autoSuggest: boolean,
    enabledSnippets: readonly ResolvedMarkdownSnippet[],
    wrapLines: boolean,
    zoomPercent: number,
    decoratePlaintextSymbols: boolean,
  ): EditorState {
    if (!documentId || !props) {
      return createState(
        content,
        language,
        showMinimap,
        showFoldGutter,
        autoClosePairs,
        autoSuggest,
        enabledSnippets,
        wrapLines,
        zoomPercent,
        decoratePlaintextSymbols,
      );
    }
    const cached = deps.sessionCache.take({
      contextId: props.contextId,
      paneId: props.paneId,
      documentId,
    });
    // Never resurrect pre-reload content from a stale cached session.
    if (cached && cached.doc.toString() === content) {
      return cached;
    }
    return createState(
      content,
      language,
      showMinimap,
      showFoldGutter,
      autoClosePairs,
      autoSuggest,
      enabledSnippets,
      wrapLines,
      zoomPercent,
      decoratePlaintextSymbols,
    );
  }

  function syncWrapLines(wrapLines: boolean): void {
    if (!view || wrapLines === lastWrapLines) {
      return;
    }
    lastWrapLines = wrapLines;
    applyWrap(view, compartments.lineWrap, wrapLines);
  }

  function syncZoomPercent(zoomPercent: number): void {
    if (!view || zoomPercent === lastZoomPercent) {
      return;
    }
    lastZoomPercent = zoomPercent;
    applyZoom(view, compartments.fontSize, zoomPercent);
  }

  function syncLanguage(language: EditorLanguageId): void {
    if (!view) {
      return;
    }
    // Mount seeds `currentEditorLanguage` to skip a redundant compartment
    // reconfigure when the pack is already in createState. Still fall through
    // when the id matches but the pack is cold — otherwise the first open of a
    // language never schedules `loadLanguageSupport` and syntax/fold stay empty.
    if (language === currentEditorLanguage) {
      if (language === "plaintext" || getLanguageSupport(language) != null) {
        return;
      }
    } else {
      currentEditorLanguage = language;
    }
    languageLoadGeneration += 1;
    const loadGeneration = languageLoadGeneration;
    const docGeneration = documentGeneration;
    const syncSupport = getLanguageSupport(language);
    if (syncSupport) {
      // Pack already cached — reconfigure once. Do not also await
      // loadLanguageSupport: it resolves in a microtask with the same
      // instance and would restart the parser a second time (tab switch).
      view.dispatch({
        effects: compartments.language.reconfigure(syncSupport),
      });
      return;
    }
    if (language === "plaintext") {
      return;
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
      effects: compartments.fold.reconfigure(foldGutterExtension(showFoldGutter)),
    });
  }

  function syncCompletion(
    autoClosePairs: boolean,
    autoSuggest: boolean,
    language: EditorLanguageId,
    enabledSnippets: readonly ResolvedMarkdownSnippet[],
  ): void {
    if (!view) {
      return;
    }
    const snippetKey = snippetCatalogKey(enabledSnippets);
    const key = `${autoClosePairs ? "1" : "0"}:${autoSuggest ? "1" : "0"}:${language}:${snippetKey}`;
    if (key === lastCompletionKey) {
      return;
    }
    lastCompletionKey = key;
    const snippetSource =
      language === "markdown" && enabledSnippets.length > 0
        ? createSnippetCompletionSource(enabledSnippets)
        : null;
    view.dispatch({
      effects: compartments.completion.reconfigure(
        completionExtension({ autoClosePairs, autoSuggest, snippetSource }),
      ),
    });
  }

  function syncSnippets(
    language: EditorLanguageId,
    enabledSnippets: readonly ResolvedMarkdownSnippet[],
  ): void {
    if (!view) {
      return;
    }
    const enabled = language === "markdown";
    const key = `${enabled ? "1" : "0"}:${snippetCatalogKey(enabledSnippets)}`;
    if (key === lastSnippetKey && lastSnippetsEnabled === enabled) {
      return;
    }
    lastSnippetKey = key;
    lastSnippetsEnabled = enabled;
    view.dispatch({
      effects: compartments.snippets.reconfigure(snippetExtension({ enabled })),
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
      next.autoClosePairs,
      next.autoSuggest,
      next.enabledSnippets,
      next.wrapLines,
      next.zoomPercent,
      next.decoratePlaintextSymbols,
    );
    view.setState(nextState);

    trackedDocumentId = next.documentId;
    // Force language/decoration/minimap/fold/completion reconfigure against possibly restored state.
    currentEditorLanguage = "" as EditorLanguageId;
    lastDecoKey = "";
    lastMinimapEnabled = null;
    lastFoldGutterEnabled = null;
    lastCompletionKey = "";
    lastSnippetKey = "";
    lastSnippetsEnabled = null;
    lastWrapLines = null;
    lastZoomPercent = null;

    // Re-apply pane-level chrome that may differ from a restored session.
    syncWrapLines(next.wrapLines);
    syncZoomPercent(next.zoomPercent);
    syncLanguage(next.language);
    syncDecorations(next.language, next.decoratePlaintextSymbols);
    syncMinimap(next.showMinimap);
    syncFoldGutter(next.showFoldGutter);
    syncCompletion(
      next.autoClosePairs,
      next.autoSuggest,
      next.language,
      next.enabledSnippets,
    );
    syncSnippets(next.language, next.enabledSnippets);
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
      autoClosePairs: true,
      autoSuggest: false,
      enabledSnippets: [],
    };

    const state = createState(
      initial.content,
      initial.language,
      initial.showMinimap,
      initial.showFoldGutter,
      initial.autoClosePairs,
      initial.autoSuggest,
      initial.enabledSnippets,
      initial.wrapLines,
      initial.zoomPercent,
      initial.decoratePlaintextSymbols,
    );
    view = new EditorView({ state, parent });

    // Wrap/zoom/fold/minimap/completion/snippets/decorations are baked into
    // createState — seed caches so later $effect updates are no-ops unless
    // props actually change. Avoid mount-time compartment reconfigure (StyleModule
    // remount / fold StateField replace) which froze the UI with keep-alive.
    lastWrapLines = initial.wrapLines;
    lastZoomPercent = initial.zoomPercent;
    lastDecoKey = `${initial.language}:${initial.decoratePlaintextSymbols}`;
    lastMinimapEnabled = initial.showMinimap;
    lastFoldGutterEnabled = initial.showFoldGutter;
    lastCompletionKey = `${initial.autoClosePairs ? "1" : "0"}:${initial.autoSuggest ? "1" : "0"}:${initial.language}:${snippetCatalogKey(initial.enabledSnippets)}`;
    lastSnippetKey = `${initial.language === "markdown" ? "1" : "0"}:${snippetCatalogKey(initial.enabledSnippets)}`;
    lastSnippetsEnabled = initial.language === "markdown";
    attachScrollListener();
    trackedDocumentId = initial.documentId;
    // Language is already in createState when cached — seed so syncLanguage
    // no-ops the compartment swap. Still call syncLanguage so a cold pack
    // schedules loadLanguageSupport (seed-only previously skipped that path).
    currentEditorLanguage = initial.language;
    documentGeneration = 1;
    applyScrollTop(initial.scrollTop);
    syncLanguage(initial.language);
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

    syncWrapLines(next.wrapLines);
    syncZoomPercent(next.zoomPercent);
    syncLanguage(next.language);
    syncDecorations(next.language, next.decoratePlaintextSymbols);
    syncMinimap(next.showMinimap);
    syncFoldGutter(next.showFoldGutter);
    syncCompletion(
      next.autoClosePairs,
      next.autoSuggest,
      next.language,
      next.enabledSnippets,
    );
    syncSnippets(next.language, next.enabledSnippets);

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
    // Do not flush scroll into app state during teardown — setDocumentScrollTop
    // mid-destroy cascades Svelte updates across keep-alive surfaces and can
    // wedge the main thread. Debounced scroll saves already cover steady state.
    if (scrollSaveTimer) {
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = null;
    }
    if (applyingScrollRaf !== null) {
      cancelAnimationFrame(applyingScrollRaf);
      applyingScrollRaf = null;
    }
    // Cached EditorStates bind to this controller's Compartment instances, so
    // every session this controller wrote must be invalidated on teardown —
    // scoped to context+pane+document so other panes (and contexts) keep
    // independent undo/fold caches for the same documentId. Per-tab keep-alive
    // siblings share a pane but different document ids; pane-level wipe would
    // drop their cache. Fallback to pane invalidation only when nothing was
    // ever written by this controller.
    if (cachedSessionKeys.size > 0) {
      for (const key of cachedSessionKeys.values()) {
        deps.sessionCache.invalidateSession(key);
      }
      cachedSessionKeys.clear();
    } else if (props?.paneId && props?.contextId) {
      // Fallback for a controller that hosted a single document (the normal
      // keep-alive case) and so never populated `cachedSessionKeys` via
      // `switchDocument`. Scope by context AND pane: a pane-only wipe would
      // drop sibling tabs and — because two restored workspaces can both have
      // `pane-1` — other contexts' cached undo/fold for the same pane id,
      // which is the opposite of M52's intent.
      deps.sessionCache.invalidatePaneInContext(props.contextId, props.paneId);
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
    requestMeasure: () => {
      if (!destroyed) {
        view?.requestMeasure();
      }
    },
    getTrackedDocumentId: () => trackedDocumentId,
    getDocumentGeneration: () => documentGeneration,
    getCompartments: () => compartments,
  };
}
